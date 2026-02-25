import puppeteer from 'puppeteer';

(async () => {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

        console.log("Waiting for data to load...");
        // Wait specifically for the loader to vanish or an event to appear
        await page.waitForFunction(() => {
            const hasText = document.body.innerText.includes("Makkelijk");
            const hasNoEvents = document.body.innerText.includes("Geen beschikbare events");
            return hasText || hasNoEvents;
        }, { timeout: 10000 });

        const html = await page.evaluate(() => document.body.innerHTML);

        console.log("--- DOM Check ---");
        console.log("Has 'Makkelijke Maandag':", html.includes("Makkelijke Maandag"));
        console.log("Has 'Ma 2 mrt':", html.includes("Ma 2 mrt"));
        console.log("Has 'Geen beschikbare events':", html.includes("Geen beschikbare events"));

        const text = await page.evaluate(() => document.body.innerText);
        console.log("\n--- Visible Text ---");
        console.log(text.substring(0, 500));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
        process.exit();
    }
})();
