const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// جلب البيانات الحساسة من GitHub Secrets لضمان الأمان
const CONFIG = {
    user: process.env.BOSAT_USER,
    pass: process.env.BOSAT_PASS,
    clientName: process.env.CLIENT_NAME, // اسم العميل الذي تريد البحث عنه
    uploadUrl: process.env.UPLOAD_URL     // رابط موقع الرفع (جوجل سكريبت)
};

(async () => {
    const downloadPath = path.resolve(__dirname, 'downloads');
    
    // 1. تنظيف وتجهيز مجلد التحميلات
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
    } else {
        fs.readdirSync(downloadPath).forEach(f => {
            try { fs.unlinkSync(path.join(downloadPath, f)); } catch(e) {}
        });
    }

    // 2. تشغيل المتصفح بإعدادات سيرفر جيت هاب
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // ضبط سلوك التحميل ليتم حفظ الملف في المجلد الذي أنشأناه
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath
    });

    try {
        // =========================================================
        // المرحلة الأولى: الدخول لموقع بوسطة واستخراج التقرير
        // =========================================================
        console.log('1. Logging into Bosat...');
        await page.goto('https://bosatexpress.com/home', { waitUntil: 'networkidle2' });
        
        await page.type('input[type="text"]', CONFIG.user);
        await page.type('input[type="password"]', CONFIG.pass);
        await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);

        console.log(`2. Searching for client: ${CONFIG.clientName}`);
        await page.goto('https://bosatexpress.com/FollowUpOrdersRep', { waitUntil: 'networkidle2' });
        
        // فتح قائمة العملاء والبحث
        await page.evaluate(() => document.querySelector('#ArMainContent_UcFollowUpOrdersReport_Lnkpopclient')?.click());
        await new Promise(r => setTimeout(r, 2000));
        await page.type('#ArMainContent_UcFollowUpOrdersReport_TxtSearchClient', CONFIG.clientName);
        await new Promise(r => setTimeout(r, 3000));
        
        // اختيار العميل (أول نتيجة تظهر)
        await page.evaluate(() => {
            const firstClient = document.querySelector('a[id*="LnkSetClient"]');
            if (firstClient) firstClient.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        // الضغط على إظهار النتائج وتحميل الإكسيل
        console.log('3. Generating report and downloading...');
        await page.evaluate(() => document.querySelector('#ArMainContent_UcFollowUpOrdersReport_LnkExecs')?.click());
        await new Promise(r => setTimeout(r, 8000)); // انتظار التحميل في الجدول

        // تنفيذ كود التحميل (printFunc هو المعتمد في بوسطة)
        await page.evaluate(() => {
            try { printFunc('FollowUpOrdersXlsRep'); } catch(e) {}
        });

        // انتظار اكتمال التحميل على السيرفر
        let downloadedFile = null;
        for (let i = 0; i < 30; i++) {
            const files = fs.readdirSync(downloadPath);
            downloadedFile = files.find(f => (f.endsWith('.xls') || f.endsWith('.xlsx')) && !f.endsWith('.crdownload'));
            if (downloadedFile) break;
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!downloadedFile) throw new Error('Download failed or took too long.');
        const fullFilePath = path.join(downloadPath, downloadedFile);
        console.log(`✅ File ready: ${downloadedFile}`);

        // =========================================================
        // المرحلة الثانية: الرفع للموقع الجديد (SELLZA) - متضمنة حل الإطار
        // =========================================================
        console.log('4. Navigating to upload site (SELLZA)...');
        await page.goto(CONFIG.uploadUrl, { waitUntil: 'networkidle2' });
        
        // استراحة بسيطة للسماح لجوجل بتحميل الإطار المخفي
        await new Promise(r => setTimeout(r, 5000)); 

        console.log('5. Searching for Google iframe...');
        let targetFrame = null;
        for (const frame of page.frames()) {
            // البحث عن الإطار الذي يحتوي على زر الرفع
            if (await frame.$('#fileInput')) {
                targetFrame = frame;
                break;
            }
        }

        if (!targetFrame) throw new Error("لم يتم العثور على إطار الرفع الخاص بجوجل.");

        console.log('6. Uploading file...');
        // التعامل مع الإطار مباشرة
        await targetFrame.waitForSelector('#fileInput', { timeout: 15000 });
        const fileInput = await targetFrame.$('#fileInput');
        await fileInput.uploadFile(fullFilePath);
        
        // الضغط على زر بدء الرفع
        await targetFrame.click('#btnUpload');
        
        console.log('7. Waiting for processing (10 seconds)...');
        await new Promise(r => setTimeout(r, 10000));

        console.log('✅ Operation Completed Successfully!');

    } catch (error) {
        console.error('❌ Error occurred:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
