const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserExecutable,launchBrowser} = require('./helpers/chrome_cdp');
test('explicit browser selection rejects invalid names and never hides a missing configured path',()=>{
  assert.throws(()=>browserExecutable('unknown'),/SELECTION_INVALID/);
  assert.throws(()=>browserExecutable('edge',{EDGE_PATH:'Z:/missing-edge-executable.exe'}),/EXECUTABLE_NOT_FOUND/);
  assert.equal(browserExecutable('edge',{EDGE_PATH:__filename}),__filename);
  assert.equal(browserExecutable('chrome',{CHROME_PATH:__filename}),__filename);
});
test('selected browser launches with isolated profile, usable CDP and owned cleanup',async()=>{
  const browser=await launchBrowser();
  try {
    if(process.env.TEST_BROWSER==='edge') assert.match(browser.version.product,/^Edg\//);
    assert.equal(await browser.session.evaluate('1+1'),2);
    assert.equal(fs.existsSync(browser.profile),true);
  } finally {await browser.close();}
  assert.equal(fs.existsSync(browser.profile),false);
  assert.ok(browser.child.exitCode!==null || browser.child.signalCode!==null);
});
test('simultaneous browser instances use different ports and profiles',async()=>{
  const first=await launchBrowser();
  let second;
  try {
    second=await launchBrowser();
    assert.notEqual(first.port,second.port);assert.notEqual(first.profile,second.profile);
    await second.close();second=null;
    assert.equal(await first.session.evaluate('2+2'),4);
  } finally {if(second) await second.close();await first.close();}
});
