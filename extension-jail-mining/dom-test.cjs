const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('D:/Tools/game-tools-playwright/node_modules/playwright');
const source = fs.readFileSync(__dirname + '/jail-mining.js', 'utf8');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<button>Nâng cấp +10</button><section class="updated-prison"><button id="dig">⛏️ Đập đá (không bớt án)</button></section>');
    await page.addScriptTag({content:'window.module={exports:{}};\n'+source});
    assert.equal(await page.evaluate(()=>module.exports.findMiningButton(document)?.id), 'dig');
    await page.evaluate(()=>document.querySelector('#dig').style.display='none');
    assert.equal(await page.evaluate(()=>module.exports.findMiningButton(document)), null);
    console.log('PASS: actual DOM selection with emoji variation and changed prison class; hidden button excluded');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
