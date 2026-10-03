const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const OUT = '/home/user/Jimmy/marketing';
const BASE = 'http://localhost:3456';
fs.mkdirSync(OUT, { recursive: true });

// Stylized meal visuals (rendered locally, no network) for the food cards.
const foodHtml = (bg, emojis, label) => `<html><body style="margin:0;width:800px;height:600px;background:${bg};display:flex;align-items:center;justify-content:center;font-family:sans-serif;position:relative;overflow:hidden">
<div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,.18),transparent 55%)"></div>
<div style="width:470px;height:470px;border-radius:50%;background:#f6f1e8;box-shadow:0 30px 60px rgba(0,0,0,.45), inset 0 0 0 18px #ece5d8;display:flex;align-items:center;justify-content:center;font-size:150px;letter-spacing:-20px">${emojis}</div>
<div style="position:absolute;bottom:26px;right:30px;color:rgba(255,255,255,.7);font-size:22px;font-weight:600">${label}</div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  if (!process.env.COMPOSITE_ONLY) {
  // 1) render meal visuals -> base64 -> DB
  const fp = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const meals = [
    ['Grilled salmon, sweet potato & broccoli', '#2f3d2a', '🐟🍠🥦', ''],
    ['Chicken salad bowl with quinoa', '#3b2f2a', '🥗🍗', ''],
    ['Veggie omelette with avocado', '#2a3340', '🍳🥑', ''],
  ];
  for (const [desc, bg, em, label] of meals) {
    await fp.setContent(foodHtml(bg, em, label));
    const buf = await fp.screenshot({ type: 'jpeg', quality: 80 });
    const b64 = buf.toString('base64');
    fs.writeFileSync('/tmp/img.b64', b64);
    execSync(`psql -h /tmp -p 5433 -U postgres -d jimmy -q`, { input: `\\set img \`cat /tmp/img.b64\`\nUPDATE food_log SET image_data = :'img' WHERE description = '${desc.replace(/'/g, "''")}';\n` });
  }

  // 2) phone screenshots
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.sync-badge{display:none!important} .ex-gif-placeholder{display:none!important}' });

  // Workout screen: day A, with one in-progress card open to show the set tracker
  await page.evaluate(() => switchTab('workout'));
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.getElementById('ex-a-5').classList.add('open'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('ex-a-5').scrollIntoView({ block: 'center' }); window.scrollBy(0, -120); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/screen-workout.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/screen-workout-top.png` });

  // Feed screen
  await page.evaluate(() => switchTab('feed'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/screen-feed.png` });
  await page.screenshot({ path: `${OUT}/screen-feed-full.png`, fullPage: true });

  }
  // 3) marketing composite: two phones side by side
  const img = (f) => 'data:image/png;base64,' + fs.readFileSync(`${OUT}/${f}`).toString('base64');
  const comp = await browser.newPage({ viewport: { width: 1600, height: 1080 }, deviceScaleFactor: 2 });
  await comp.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet"></head>
  <body style="margin:0;width:1600px;height:1080px;background:radial-gradient(circle at 50% 0%,#2a1414,#0d0d0f 60%);font-family:Inter,Helvetica,Arial,sans-serif;color:#fff;position:relative;overflow:hidden">
    <div style="position:absolute;top:70px;left:0;right:0;text-align:center">
      <div style="font-family:'Bebas Neue',Impact,sans-serif;font-size:96px;letter-spacing:6px;line-height:1">JIMMY</div>
      <div style="font-size:24px;color:#bbb;margin-top:8px">Track every set. Snap every meal.</div>
    </div>
    <div style="position:absolute;top:250px;left:0;right:0;display:flex;justify-content:center;gap:120px">
      ${['screen-workout.png', 'screen-feed.png'].map((f, i) => `
      <div style="text-align:center">
        <div style="width:390px;height:844px;border-radius:52px;background:#000;padding:12px;box-shadow:0 40px 90px rgba(0,0,0,.7),0 0 0 2px #333;transform:scale(.82);transform-origin:top center">
          <div style="width:390px;height:844px;border-radius:40px;overflow:hidden;position:relative">
            <img src="${img(f)}" style="width:390px;height:844px;display:block">
            
          </div>
        </div>
        <div style="margin-top:-140px;font-size:22px;color:#e5e5e5;font-weight:600">${i === 0 ? '💪 Workout tracking with live set counters' : '📸 AI food log with paleo verdicts'}</div>
      </div>`).join('')}
    </div>
  </body></html>`);
  await comp.waitForTimeout(800);
  await comp.screenshot({ path: `${OUT}/jimmy-marketing-mockup.png` });
  await browser.close();
  console.log('done');
})();
