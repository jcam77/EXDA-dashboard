import { test, expect } from '@playwright/test';

// This test assumes the dashboard is running and accessible at localhost:3000 or similar
// Adjust the URL as needed for your environment

test.describe('Experiment Selection', () => {
  test('Selecting Pressure CSV adds to queue and checks tick box', async ({ page }) => {
    await page.goto('http://localhost:5173/data');
    // Select a Pressure CSV from the dropdown using data-testid
    await page.selectOption('[data-testid="pressure-csv-select"]', { index: 1 });
    // Check that the queue contains the selected file and the tick box is checked
    const queueItem = await page.locator('.group').first();
    await expect(queueItem).toBeVisible();
    const checkbox = queueItem.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();
  });

  test('Selecting Flame CSV adds to queue and checks tick box', async ({ page }) => {
    await page.goto('http://localhost:5173/data');
    await page.selectOption('[data-testid="flame-csv-select"]', { index: 1 });
    const queueItem = await page.locator('.group').nth(1);
    await expect(queueItem).toBeVisible();
    const checkbox = queueItem.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();
  });

  test('Only files are selectable, not folders', async ({ page }) => {
    await page.goto('http://localhost:5173/data');
    const options = await page.locator('select option').allTextContents();
    // Check that no option text contains 'Folder' or similar
    for (const opt of options) {
      expect(opt.toLowerCase()).not.toContain('folder');
    }
  });

  test('Queue and selector stay in sync after removal', async ({ page }) => {
    await page.goto('http://localhost:5173/data');
    await page.selectOption('[data-testid="pressure-csv-select"]', { index: 1 });
    const queueItem = await page.locator('.group').first();
    await expect(queueItem).toBeVisible();
    // Remove from queue
    await queueItem.locator('button').click();
    await expect(queueItem).not.toBeVisible();
    // The tick box should be unchecked
    const checkbox = queueItem.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
  });
});
