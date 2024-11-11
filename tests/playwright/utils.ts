import { expect } from '@playwright/test';

export async function waitForStatusText(page: any, selector: string, statusText: string, maxAttempts: number = 5, intervalTimeout: number = 60000) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await expect(page.locator(selector).first()).toHaveText(statusText, { timeout: intervalTimeout });
            return;
        } catch (error) {
            console.log(`Attempt ${i + 1} failed: ${error}`);
        }
    }
    throw new Error(`Failed to find text "${statusText}" in element "${selector}" after ${maxAttempts} attempts`);
}