import argparse
import datetime as dt
import os
import re
import sqlite3
import sys

import openpyxl
from openpyxl.utils.datetime import from_excel


DEFAULT_TEACHERS = ["何君", "李骥", "陆俊诚", "王硕", "吴昌泽", "晏英杰", "张君扬", "周奇洋"]


def find_total_sheet(wb):
    for name in wb.sheetnames:
        if re.fullmatch(r"\d{1,2}月总表", name):
            return name
    if "4月总表" in wb.sheetnames:
        return "4月总表"
    raise RuntimeError("未找到月度总表（如 2月总表、3月总表、4月总表）")


def text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def number(value):
    if value in (None, ""):
        return 0
    try:
        return float(value)
    except Exception:
        return 0


def iso_date(value):
    if value in (None, ""):
        return ""
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        try:
            return from_excel(value).date().isoformat()
        except Exception:
            return ""
    raw = text(value)
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return dt.datetime.strptime(raw[:10], fmt).date().isoformat()
        except Exception:
            pass
    return raw


def split_students(value):
    return [part.strip() for part in re.split(r"[、,，;；]", text(value)) if part.strip()]


def ensure_schema_exists(conn):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='lessons'"
    ).fetchone()
    if not row:
        raise RuntimeError("数据库未初始化。请先在 liming-course-system 目录运行 npm run init。")
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='teacher_adjustments_monthly'"
    ).fetchone()
    if not row:
        raise RuntimeError("数据库结构需要升级。请先运行 npm run init 以创建 teacher_adjustments_monthly。")


def upsert_student(conn, name, grade):
    if not name:
        return
    conn.execute(
        """
        INSERT INTO students(name, grade) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET
          grade = COALESCE(NULLIF(excluded.grade, ''), students.grade)
        """,
        (name, grade or ""),
    )


def upsert_teacher(conn, name):
    if not name:
        return
    conn.execute("INSERT OR IGNORE INTO teachers(name) VALUES (?)", (name,))


def import_lessons(conn, wb, total_sheet_name, month_key, replace):
    ws = wb[total_sheet_name]
    if replace:
        conn.execute("DELETE FROM lessons WHERE month_key = ?", (month_key,))
    inserted = 0
    for row_idx in range(3, ws.max_row + 1):
        teacher = text(ws.cell(row_idx, 1).value)
        date = iso_date(ws.cell(row_idx, 2).value)
        lesson_status = text(ws.cell(row_idx, 3).value)
        time_slot = text(ws.cell(row_idx, 5).value)
        classroom = text(ws.cell(row_idx, 6).value)
        grade = text(ws.cell(row_idx, 7).value)
        subject = text(ws.cell(row_idx, 8).value)
        student_names = text(ws.cell(row_idx, 9).value)
        notes = text(ws.cell(row_idx, 10).value)
        course_status = text(ws.cell(row_idx, 11).value)
        teacher_salary = number(ws.cell(row_idx, 12).value)
        if not any([teacher, date, lesson_status, time_slot, classroom, grade, subject, student_names, notes, course_status, teacher_salary]):
            continue
        upsert_teacher(conn, teacher)
        for name in split_students(student_names):
            upsert_student(conn, name, grade)
        conn.execute(
            """
            INSERT INTO lessons(
              teacher_name, date, lesson_status, time_slot, classroom, grade, subject,
              student_names, notes, course_status, teacher_salary, month_key, sort_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                teacher,
                date,
                lesson_status or "上课",
                time_slot,
                classroom,
                grade,
                subject,
                student_names,
                notes,
                course_status or "未上",
                teacher_salary,
                month_key,
                row_idx,
            ),
        )
        inserted += 1
    return inserted


def import_recharges(conn, wb, month_key):
    if "充值记录" not in wb.sheetnames:
        return 0
    ws = wb["充值记录"]
    count = 0
    for row_idx in range(3, ws.max_row + 1):
        student_name = text(ws.cell(row_idx, 1).value)
        if not student_name:
            continue
        payload = (
            student_name,
            text(ws.cell(row_idx, 2).value),
            number(ws.cell(row_idx, 3).value),
            number(ws.cell(row_idx, 4).value),
            number(ws.cell(row_idx, 5).value),
            number(ws.cell(row_idx, 6).value),
            iso_date(ws.cell(row_idx, 7).value),
            text(ws.cell(row_idx, 8).value),
            month_key,
        )
        conn.execute(
            """
            INSERT INTO recharge_records(
              student_name, grade, prev_actual, prev_gift, cur_recharge, cur_gift,
              recharge_date, notes, month_key
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_name, month_key) DO UPDATE SET
              grade = excluded.grade,
              prev_actual = excluded.prev_actual,
              prev_gift = excluded.prev_gift,
              cur_recharge = excluded.cur_recharge,
              cur_gift = excluded.cur_gift,
              recharge_date = excluded.recharge_date,
              notes = excluded.notes
            """,
            payload,
        )
        upsert_student(conn, student_name, payload[1])
        count += 1
    return count


def import_student_pricing(conn, wb):
    if "学生单价表" not in wb.sheetnames:
        return 0
    ws = wb["学生单价表"]
    count = 0
    for row_idx in range(3, ws.max_row + 1):
        student_name = text(ws.cell(row_idx, 1).value)
        subject = text(ws.cell(row_idx, 2).value)
        helper = text(ws.cell(row_idx, 8).value)
        if (not student_name or not subject) and "|" in helper:
          parts = helper.split("|", 1)
          student_name = student_name or parts[0].strip()
          subject = subject or parts[1].strip()
        custom_price = ws.cell(row_idx, 3).value
        if not student_name or not subject or custom_price in (None, ""):
            continue
        conn.execute(
            """
            INSERT INTO student_pricing(student_name, subject, custom_price, notes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(student_name, subject) DO UPDATE SET
              custom_price = excluded.custom_price,
              notes = excluded.notes
            """,
            (student_name, subject, number(custom_price), text(ws.cell(row_idx, 6).value)),
        )
        count += 1
    return count


def import_pricing_standards(conn, wb):
    if "费用标准" not in wb.sheetnames:
        return 0
    ws = wb["费用标准"]
    count = 0
    for row_idx in range(3, ws.max_row + 1):
        grade = text(ws.cell(row_idx, 1).value)
        student_count = int(number(ws.cell(row_idx, 2).value))
        unit_price = ws.cell(row_idx, 3).value
        if not grade or not student_count or unit_price in (None, ""):
            continue
        conn.execute(
            """
            INSERT INTO pricing_standards(grade, student_count, unit_price, description)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(grade, student_count) DO UPDATE SET
              unit_price = excluded.unit_price,
              description = excluded.description
            """,
            (grade, student_count, number(unit_price), text(ws.cell(row_idx, 5).value)),
        )
        count += 1
    return count


def import_teacher_adjustments(conn, wb, month_key):
    if "教师薪资汇总" not in wb.sheetnames:
        return 0
    ws = wb["教师薪资汇总"]
    count = 0
    for row_idx in range(3, ws.max_row + 1):
        teacher_name = text(ws.cell(row_idx, 1).value)
        if not teacher_name or teacher_name == "合计":
            continue
        upsert_teacher(conn, teacher_name)
        conn.execute(
            """
            INSERT INTO teacher_adjustments_monthly(
              teacher_name, month_key, week1_transport, week2_transport, week3_transport, week4_transport, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(teacher_name, month_key) DO UPDATE SET
              week1_transport = excluded.week1_transport,
              week2_transport = excluded.week2_transport,
              week3_transport = excluded.week3_transport,
              week4_transport = excluded.week4_transport,
              notes = excluded.notes
            """,
            (
                teacher_name,
                month_key,
                number(ws.cell(row_idx, 4).value),
                number(ws.cell(row_idx, 5).value),
                number(ws.cell(row_idx, 6).value),
                number(ws.cell(row_idx, 7).value),
                text(ws.cell(row_idx, 9).value),
            ),
        )
        count += 1
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", help="Excel 工作簿路径")
    parser.add_argument("--month", help="导入到指定月份，格式 YYYY-MM-01；不传时读取工作簿 4月总表!Q1")
    parser.add_argument("--db", default=os.path.join(os.path.dirname(__file__), "..", "data", "liming-local.sqlite"))
    parser.add_argument("--append", action="store_true", help="追加课程，不清空同月已有课程")
    args = parser.parse_args()

    workbook_path = os.path.abspath(args.workbook)
    db_path = os.path.abspath(args.db)
    if not os.path.exists(workbook_path):
        raise FileNotFoundError(workbook_path)

    wb = openpyxl.load_workbook(workbook_path, data_only=True, read_only=False)
    total_sheet_name = find_total_sheet(wb)

    month_key = iso_date(args.month) or iso_date(wb[total_sheet_name]["Q1"].value) or "2026-04-01"

    conn = sqlite3.connect(db_path, isolation_level=None)
    try:
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")
        conn.execute("PRAGMA temp_store = MEMORY")
        conn.execute("PRAGMA locking_mode = EXCLUSIVE")
        conn.execute("BEGIN")
        ensure_schema_exists(conn)
        conn.execute("UPDATE settings SET value = ? WHERE key = 'month_key'", (month_key,))
        for teacher in DEFAULT_TEACHERS:
            upsert_teacher(conn, teacher)
        lessons = import_lessons(conn, wb, total_sheet_name, month_key, replace=not args.append)
        recharges = import_recharges(conn, wb, month_key)
        student_prices = import_student_pricing(conn, wb)
        standards = import_pricing_standards(conn, wb)
        teacher_adjustments = import_teacher_adjustments(conn, wb, month_key)
        conn.commit()
    finally:
        conn.close()

    print(f"导入完成：{workbook_path}")
    print(f"月份：{month_key}")
    print(f"课程：{lessons}")
    print(f"充值记录：{recharges}")
    print(f"学生单价：{student_prices}")
    print(f"费用标准：{standards}")
    print(f"教师交通费：{teacher_adjustments}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"导入失败：{exc}", file=sys.stderr)
        sys.exit(1)
