import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const output = 'output/playwright';
const artifacts = process.env.AMR_RECORD === '1';

test('runs the forklift drill through both deliveries, exports it, and scrubs offline replay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Warehouse Under Pressure' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select AMR-01 in warehouse' })).toBeVisible();
  await expect.poll(async () => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(25_000);
  await expect(page.locator('.scene-failure')).not.toBeVisible();
  if (artifacts) {
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: `${output}/mission-control.png`, fullPage: true });
  }

  const viewport = page.locator('.viewport');
  const timeline = page.locator('.timeline');
  const metrics = page.locator('.operations');
  await page.getByRole('button', { name: 'Run scenario' }).click();
  await expect(viewport.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(viewport.getByText('Forklift obstruction', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(timeline.getByText('Alternate route found', { exact: true })).toBeAttached();
  if (artifacts) await page.screenshot({ path: `${output}/incident.png` });

  await expect(timeline.getByText('Traffic hold', { exact: true }).first()).toBeAttached({ timeout: 25_000 });
  await expect(timeline.getByText('Delivery completed', { exact: true })).toHaveCount(2, { timeout: 100_000 });
  await viewport.getByRole('button', { name: 'Pause' }).click();
  const paused = await viewport.locator('.sim-clock b').textContent();
  await expect(viewport.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(viewport.locator('.sim-clock b')).toHaveText(paused!);
  await expect(metrics.locator('.metric').filter({ hasText: 'CONTACTS' }).locator('strong')).toHaveText('0');

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Replay JSON' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('amr-forge-local-recording.json');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(page.getByText('No verified Isaac Sim recordings available')).toBeVisible();
  await page.getByRole('button', { name: 'Replay local run' }).first().click();
  await expect(page.getByText('Local Simulation Replay', { exact: false })).toBeVisible();
  const scrubber = page.getByRole('slider', { name: 'Replay position' });
  await scrubber.fill('6');
  await expect(viewport.getByText('Forklift obstruction', { exact: false })).toBeVisible();
  await expect(timeline.getByText('Safety stop', { exact: true })).toBeAttached();
  await expect(timeline.getByText('Delivery completed', { exact: true })).toHaveCount(0);
  await viewport.getByRole('combobox', { name: 'Camera' }).selectOption('Robot POV');
  await expect(viewport.getByText('SIMULATED ROBOT POV', { exact: false })).toBeVisible();
  await viewport.getByRole('button', { name: 'Rewind replay' }).click();
  await expect(viewport.getByText('Forklift obstruction', { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('selects robots, changes destinations, toggles overlays, and runs comparisons on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Warehouse Under Pressure' })).toBeVisible();
  const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(dimensions[0]).toEqual(dimensions[1]);
  await page.getByRole('button', { name: /^AMR-02 Vega/ }).click();
  await expect(page.getByRole('button', { name: /^AMR-02 Vega/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delivery control' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Destination' }).selectOption('C01', { timeout: 4000 });
  await page.getByRole('button', { name: 'Set destination' }).click();
  await expect(page.getByRole('button', { name: /^AMR-02 Vega.*C01/ })).toBeVisible();
  const lidar = page.getByRole('button', { name: 'Toggle LiDAR' });
  await lidar.click();
  await expect(lidar).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Benchmarks', exact: true }).click();
  await page.getByRole('button', { name: 'Run benchmark' }).click();
  await expect(page.getByRole('rowheader', { name: 'Dynamic A* + reservations', exact: true })).toBeVisible();
  await expect(page.getByText('2 / 2 deliveries')).toBeVisible();
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.getByRole('button', { name: 'Start mission' }).click();
  await page.getByRole('button', { name: 'Inject incident' }).click();
  await expect(page.locator('.viewport').getByText('Forklift obstruction', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reset simulation' }).click();
  await expect(page.getByRole('button', { name: 'Start mission' })).toBeVisible();
});
