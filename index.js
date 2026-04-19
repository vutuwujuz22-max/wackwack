const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const CONFIG = {
    user: process.env.BOSAT_USER,
    pass: process.env.BOSAT_PASS,
    clientName: process.env.CLIENT_NAME, 
    uploadUrl: process.env.UPLOAD_URL     
};

(async () => {
    const downloadPath = path.resolve(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) { fs.mkdirSync(downloadPath); }
    else { fs.readdirSync(downloadPath).forEach(f => { try { fs.unlinkSync(path.join(downloadPath, f)); } catch(e) {} }); }

    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    page.on('console', msg => {
        if(msg.type() === 'error' || msg.type() === 'warning') 
            console.log('💻 [رسالة من داخل بوسطة]:', msg.text());
    });
    page.on('pageerror', err => console.log('❌ [عطل جافاسكريبت في بوسطة]:', err.message));
    page.on('dialog', async dialog => {
        console.log('⚠️ [رسالة منبثقة/Alert]:', dialog.message());
        await dialog.accept();
    });

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

    try {
        console.log('1. فتح بوسطة وتسجيل الدخول...');
        await page.goto('https://bosatexpress.com/home', { waitUntil: 'networkidle2' });
        await page.type('input[type="text"]', CONFIG.user);
        await page.type('input[type="password"]', CONFIG.pass);
        await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
        console.log('✅ تم تسجيل الدخول.');

        console.log(`2. البحث عن العميل: ${CONFIG.clientName}`);
        await page.goto('https://bosatexpress.com/FollowUpOrdersRep', { waitUntil: 'networkidle2' });
        
        await page.evaluate(() => document.querySelector('#ArMainContent_UcFollowUpOrdersReport_Lnkpopclient')?.click());
        await new Promise(r => setTimeout(r, 2000));
        await page.type('#ArMainContent_UcFollowUpOrdersReport_TxtSearchClient', CONFIG.clientName);
        await new Promise(r => setTimeout(r, 3000));
        
        // =========================================================
        // التعديل: استهداف أيقونة التحميل البنفسجية في صف العميل
        // =========================================================
        console.log('جاري محاولة اختيار العميل من القائمة...');
        const clientSelected = await page.evaluate(() => {
            // البحث عن كل الروابط التي تحتوي على أيقونة التحميل
            const links = Array.from(document.querySelectorAll('a[id*="LnkSetClient"]'));
            // اختيار أول رابط مرئي (بعد الفلترة بالبحث)
            for (let link of links) {
                // التأكد من أن العنصر و/أو الأيقونة مرئية
                if (link.offsetParent !== null) {
                    link.click();
                    return true;
                }
            }
            return false;
        });
        console.log(clientSelected ? '✅ تم الضغط على أيقونة العميل.' : '❌ عطل: لم يتم العثور على أيقونة العميل المرئية!');
        await new Promise(r => setTimeout(r, 2000));

        console.log('3. إدخال التواريخ (من الشهر الماضي لليوم)...');
        const today = new Date();
        const endDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const startDate = `${String(lastMonth.getDate()).padStart(2, '0')}/${String(lastMonth.getMonth() + 1).padStart(2, '0')}/${lastMonth.getFullYear()}`;

        const datesEntered = await page.evaluate((start, end) => {
            const fromInput = document.querySelector('#ArMainContent_UcFollowUpOrdersReport_Txt_From_Date');
            const toInput = document.querySelector('#ArMainContent_UcFollowUpOrdersReport_Txt_To_Date');
            if(fromInput && toInput) {
                fromInput.value = start; fromInput.dispatchEvent(new Event('change', { bubbles: true }));
                toInput.value = end; toInput.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }, startDate, endDate);
        console.log(datesEntered ? '✅ تم كتابة التواريخ.' : '❌ عطل: خانات التاريخ غير موجودة!');
        await new Promise(r => setTimeout(r, 1500));

        console.log('4. الضغط على "إظهار النتائج"...');
        const execClicked = await page.evaluate(() => {
            const btn = document.querySelector('#ArMainContent_UcFollowUpOrdersReport_LnkExecs');
            if (btn) { btn.click(); return true; }
            return false;
        });
        console.log(execClicked ? '✅ تم الضغط، انتظار 10 ثواني لتحميل الجدول...' : '❌ عطل: زر إظهار النتائج غير موجود!');
        await new Promise(r => setTimeout(r, 10000));

        const noData = await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes('لا توجد بيانات') || text.includes('No records') || text.includes('لا يوجد');
        });
        if (noData) console.log('⚠️ تحذير: الموقع مكتوب فيه "لا توجد بيانات" لهذا العميل في هذه الفترة!');

        console.log('5. فحص وتشغيل دالة التحميل (printFunc)...');
        const printResult = await page.evaluate(() => {
            if (typeof printFunc === 'function') {
                try { printFunc('FollowUpOrdersXlsRep'); return '✅ دالة التحميل موجودة وتم تشغيلها.'; }
                catch(e) { return '❌ الدالة موجودة لكن ضربت خطأ: ' + e.message; }
            } else {
                return '❌ الدالة printFunc مش موجودة أصلاً في الصفحة (الموقع اتحدث)!';
            }
        });
        console.log('نتيجة الفحص:', printResult);

        let downloadedFile = null;
        for (let i = 0; i < 45; i++) {
            const files = fs.readdirSync(downloadPath);
            downloadedFile = files.find(f => (f.endsWith('.xls') || f.endsWith('.xlsx') || f.endsWith('.csv')) && !f.endsWith('.crdownload'));
            if (downloadedFile) break;
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!downloadedFile) throw new Error('التحميل لم يبدأ أو فشل. راجع الـ Logs فوق لمعرفة السبب الحقيقي.');
        console.log(`✅ تم التقاط الملف بنجاح: ${downloadedFile}`);

        console.log('6. الذهاب لموقع SELLZA للرفع...');
        await page.goto(CONFIG.uploadUrl, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000)); 

        let targetFrame = null;
        for (const frame of page.frames()) {
            if (await frame.$('#fileInput')) { targetFrame = frame; break; }
        }

        if (!targetFrame) throw new Error("❌ لم يتم العثور على إطار الرفع (iframe).");

        console.log('7. رفع الملف...');
        await targetFrame.waitForSelector('#fileInput', { timeout: 15000 });
        const fileInput = await targetFrame.$('#fileInput');
        await fileInput.uploadFile(path.join(downloadPath, downloadedFile));
        await targetFrame.click('#btnUpload');
        
        console.log('8. انتظار المعالجة...');
        await new Promise(r => setTimeout(r, 10000));
        console.log('✅ اكتملت العملية بنجاح الصاروخ!');

    } catch (error) {
        console.error('\n🔴🔴🔴 [التقرير النهائي للعطل] 🔴🔴🔴');
        console.error(error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
