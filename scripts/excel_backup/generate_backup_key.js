#!/usr/bin/env node
const crypto = require("node:crypto");

const key = crypto.randomBytes(32).toString("base64");
process.stdout.write("请立即离线保存下面的备份加密密钥。程序不会写入文件或数据库，也无法在以后重新显示同一密钥。\n");
process.stdout.write("密钥丢失后，百度网盘中的加密备份将无法恢复。\n");
process.stdout.write(`${key}\n`);
