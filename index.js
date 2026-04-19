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
    
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
    } else {
        fs.readdirSync(downloadPath).forEach(f => {
            try { fs.unlinkSync(path.join(downloadPath, f)); } catch(e) {}
        });
    }

    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath
    });

    try {
        console.log('1. Logging into Bosat...');
        await page.goto('https://bosatexpress.com/home', { waitUntil: 'networkidle2' });
        
        await page.type('input[type="text"]', CONFIG.user);
        await page.type('input[type="password"]', CONFIG.pass);
        await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);

        console.log(`2. Searching for client: ${CONFIG.clientName}`);
        await page.goto('https://bosatexpress.com/FollowUpOrdersRep', { waitUntil: 'networkidle2' });
        
        await page.evaluate(() => document.querySelector('#ArMainContent_UcFollowUpOrdersReport_Lnkpopclient')?.click());
        await new Promise(r => setTimeout(r, 2000));
        await page.type('#ArMainContent_UcFollowUpOrdersReport_TxtSearchClient', CONFIG.clientName);
        await new Promise(r => setTimeout(r, 3000));
        
        await page.evaluate(() => {
            const firstClient = document.querySelector('a[id*="LnkSetClient"]');
            if (firstClient) firstClient.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        // ==========================================
        // الجزء الذي تمت إضافته: إدخال التواريخ
        // ==========================================
        console.log('3. Setting Date Range...');
        const today = new Date();
        const endDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const startDate = `${String(lastMonth.getDate()).padStart(2, '0')}/${String(lastMonth.getMonth() + 1).padStart(2, '0')}/${lastMonth.getFullYear()}`;

        await page.evaluate((start, end) => {
            const fromInput = document.querySelector('#ArMainContent_UcFollowUpOrdersReport_Txt_From_Date');
            const toInput = document.querySelector('#ArMainContent_UcFollowUpOrdersReport_Txt_To_Date');
            if(fromInput && toInput) {
                fromInput.value = start;
                fromInput.dispatchEvent(new Event('change', { bubbles: true }));
                toInput.value = end;
                toInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, startDate, endDate);
        await new Promise(r => setTimeout(r, 1500));
        // ==========================================

        console.log('4. Generating report and downloading...');
        await page.evaluate(() => document.querySelector('#ArMainContent_UcFollowUpOrdersReport_LnkExecs')?.click());
        await new Promise(r => setTimeout(r, 8000)); 

        await page.evaluate(() => {
            try { printFunc('FollowUpOrdersXlsRep'); } catch(e) {}
        });

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

        console.log('5. Navigating to upload site...');
        await page.goto(CONFIG.uploadUrl, { waitUntil: 'networkidle2' });
        
        await new Promise(r => setTimeout(r, 5000)); 

        console.log('6. Searching for Google iframe...');
        let targetFrame = null;
        for (const frame of page.frames()) {
            if (await frame.$('#fileInput')) {
                targetFrame = frame;
                break;
            }
        }

        if (!targetFrame) throw new Error("لم يتم العثور على إطار الرفع الخاص بجوجل.");

        console.log('7. Uploading file...');
        await targetFrame.waitForSelector('#fileInput', { timeout: 15000 });
        const fileInput = await targetFrame.$('#fileInput');
        await fileInput.uploadFile(fullFilePath);
        
        await targetFrame.click('#btnUpload');
        
        console.log('8. Waiting for processing (10 seconds)...');
        await new Promise(r => setTimeout(r, 10000));

        console.log('✅ Operation Completed Successfully!');

    } catch (error) {
        console.error('❌ Error occurred:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
