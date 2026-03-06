const { test, expect } = require('@playwright/test');

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

async function collectVisualBugs(page, context = '') {
  const bugs = [];
  const viewportWidth = page.viewportSize().width;

  // Check for elements overflowing viewport horizontally
  // Skip elements inside scrollable containers (their getBoundingClientRect extends past viewport but they're clipped)
  const overflowing = await page.evaluate((vpWidth) => {
    function isInsideScrollable(el) {
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflow === 'hidden') return true;
        parent = parent.parentElement;
      }
      return false;
    }
    const issues = [];
    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > vpWidth + 2 && !isInsideScrollable(el)) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className?.toString().slice(0, 60) || '';
        const id = el.id || '';
        issues.push({
          element: `${tag}${id ? '#' + id : ''}${cls ? '.' + cls.split(' ')[0] : ''}`,
          right: Math.round(rect.right),
          viewportWidth: vpWidth,
        });
      }
    });
    return issues;
  }, viewportWidth);

  overflowing.forEach(o => {
    bugs.push(`[${context}] Horizontal overflow: <${o.element}> extends to ${o.right}px (viewport: ${o.viewportWidth}px)`);
  });

  // Check for zero-height text elements
  const clipped = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('h1, h2, h3, p, span, a, button').forEach(el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (el.textContent.trim().length > 0 && rect.height === 0 && style.display !== 'none') {
        issues.push({ element: el.tagName + (el.id ? '#' + el.id : ''), text: el.textContent.trim().slice(0, 40) });
      }
    });
    return issues;
  });

  clipped.forEach(c => {
    bugs.push(`[${context}] Zero-height text element: <${c.element}> "${c.text}"`);
  });

  return bugs;
}

// ═══════════════════════════════════════════════════
//  DESKTOP TESTS
// ═══════════════════════════════════════════════════

test.describe('Desktop - use.html', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name.includes('Mobile'), 'Desktop only');
  });

  test('page loads without JS errors', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    expect(jsErrors, `JS errors:\n${jsErrors.join('\n')}`).toHaveLength(0);
  });

  test('swipe view is NOT visible on desktop', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const swipeView = page.locator('#swipe-view');
    await expect(swipeView).toBeHidden();
    const hasMobileClass = await page.evaluate(() => document.body.classList.contains('mobile-swipe-active'));
    expect(hasMobileClass).toBe(false);
  });

  test('navigation is visible and functional', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('nav a[href="./index.html"]').first()).toBeVisible();
    await expect(page.locator('nav').locator('text=Early Access')).toBeVisible();
  });

  test('hero section renders correctly', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('tinyNature');
    await expect(page.locator('.hero-section p')).toBeVisible();
  });

  test('featured section shows cards', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    const featuredCards = page.locator('#featured-grid .use-card');
    const count = await featuredCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('filter tags work correctly', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    const allTag = page.locator('.tag-pill[data-tag="all"]');
    await expect(allTag).toHaveClass(/active/);

    const healthTag = page.locator('.tag-pill[data-tag="Health"]');
    if (await healthTag.isVisible()) {
      await healthTag.click();
      await page.waitForTimeout(300);
      await expect(healthTag).toHaveClass(/active/);
      await expect(allTag).not.toHaveClass(/active/);
      const hiddenCount = await page.locator('.group-section.hidden-group').count();
      expect(hiddenCount).toBeGreaterThan(0);
    }
  });

  test('group sections render with cards', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    const groups = page.locator('.group-section');
    const groupCount = await groups.count();
    expect(groupCount).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < Math.min(groupCount, 3); i++) {
      await expect(groups.nth(i).locator('h2')).toBeVisible();
      const cardCount = await groups.nth(i).locator('.use-card').count();
      expect(cardCount).toBeGreaterThan(0);
    }
  });

  test('no horizontal overflow on desktop', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const bugs = await collectVisualBugs(page, 'desktop');
    const overflowBugs = bugs.filter(b => b.includes('overflow'));
    expect(overflowBugs, `Overflow bugs:\n${overflowBugs.join('\n')}`).toHaveLength(0);
  });

  test('card hover shows CTA', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    const firstCard = page.locator('.use-card').first();
    const cta = firstCard.locator('.card-cta');
    await expect(cta).toHaveCSS('opacity', '0');
    await firstCard.hover();
    await page.waitForTimeout(300);
    await expect(cta).toHaveCSS('opacity', '1');
  });

  test('CTA section renders', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await expect(page.locator('.cta-section')).toBeVisible();
    await expect(page.locator('.cta-section a[href*="wa.me"]').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════
//  MOBILE TESTS
// ═══════════════════════════════════════════════════

test.describe('Mobile - use.html', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.name.includes('Mobile'), 'Mobile only');
  });

  test('page loads without JS errors', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    expect(jsErrors, `JS errors:\n${jsErrors.join('\n')}`).toHaveLength(0);
  });

  test('auto-enters swipe mode on mobile', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const hasMobileClass = await page.evaluate(() => document.body.classList.contains('mobile-swipe-active'));
    expect(hasMobileClass).toBe(true);
    await expect(page.locator('#swipe-view')).toBeVisible();
  });

  test('nav, hero, filters, footer are hidden on mobile', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await expect(page.locator('nav')).toBeHidden();
    await expect(page.locator('.hero-section')).toBeHidden();
    await expect(page.locator('.sticky-filter')).toBeHidden();
    await expect(page.locator('#groups-container')).toBeHidden();
    await expect(page.locator('footer')).toBeHidden();
  });

  test('swipe container fills viewport', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const viewport = page.viewportSize();
    const box = await page.locator('#swipe-view').boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThan(viewport.height * 0.8);
    expect(box.y).toBeLessThan(20);
  });

  test('swipe card is visible and properly sized', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const topCard = page.locator('.swipe-card').first();
    await expect(topCard).toBeVisible();
    const box = await topCard.boundingBox();
    const viewport = page.viewportSize();
    expect(box.width).toBeGreaterThan(viewport.width * 0.7);
    expect(box.height).toBeGreaterThan(150);
    await expect(topCard.locator('h3')).toBeVisible();
    await expect(topCard.locator('p').first()).toBeVisible();
  });

  test('swipe card content is visible', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const cards = page.locator('.swipe-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    // Verify card h3 and description are present
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();
    const title = firstCard.locator('h3');
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    expect(titleText.trim().length).toBeGreaterThan(5);
    const desc = firstCard.locator('p').first();
    await expect(desc).toBeVisible();
  });

  test('swipe buttons are visible and within viewport', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const buttons = page.locator('.swipe-buttons button');
    const count = await buttons.count();
    expect(count).toBe(2);
    const viewport = page.viewportSize();
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 5);
    }
  });

  test('swipe buttons are not cut off at bottom', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const viewport = page.viewportSize();
    const box = await page.locator('.swipe-buttons').boundingBox();
    expect(box).not.toBeNull();
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 5);
  });

  test('progress bar shows correct count', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const progressText = page.locator('#swipe-progress-text');
    await expect(progressText).toBeVisible();
    const text = await progressText.textContent();
    expect(text).toMatch(/^0\s*\/\s*\d+$/);
    const total = parseInt(text.split('/')[1].trim());
    expect(total).toBeGreaterThan(50);
  });

  test('tap reject button advances card', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const rejectBtn = page.locator('.swipe-buttons button').first();
    await rejectBtn.tap();
    await page.waitForTimeout(500);
    const text = await page.locator('#swipe-progress-text').textContent();
    expect(text).toMatch(/^1\s*\/\s*\d+$/);
  });

  test('tap shortlist button advances card', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const shortlistBtn = page.locator('.swipe-buttons button').last();
    await shortlistBtn.tap();
    await page.waitForTimeout(500);
    const text = await page.locator('#swipe-progress-text').textContent();
    expect(text).toMatch(/^1\s*\/\s*\d+$/);
  });

  test('swipe via drag gesture works', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const card = page.locator('.swipe-card').first();
    const cardBox = await card.boundingBox();
    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;

    // Use mouse drag (which the drag handler also supports)
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Drag right 200px in steps
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(startX + i * 20, startY);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);

    const text = await page.locator('#swipe-progress-text').textContent();
    expect(text).toMatch(/^1\s*\/\s*\d+$/);
  });

  test('page is not scrollable in swipe mode', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBe(scrollBefore);
  });

  test('no horizontal overflow on mobile', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const bugs = await collectVisualBugs(page, 'mobile');
    const overflowBugs = bugs.filter(b => b.includes('overflow'));
    expect(overflowBugs, `Overflow bugs:\n${overflowBugs.join('\n')}`).toHaveLength(0);
  });

  test('swipe overlays start hidden', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const card = page.locator('.swipe-card[style*="z-index: 10"]');
    await expect(card.locator('.overlay-yes')).toHaveCSS('opacity', '0');
    await expect(card.locator('.overlay-no')).toHaveCSS('opacity', '0');
  });

  test('card content is readable (font sizes)', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const topCard = page.locator('.swipe-card[style*="z-index: 10"]');
    const titleFs = await topCard.locator('h3').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const descFs = await topCard.locator('p').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(titleFs).toBeGreaterThanOrEqual(18);
    expect(descFs).toBeGreaterThanOrEqual(14);
  });

  test('multiple swipes work in sequence', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    for (let i = 0; i < 5; i++) {
      const btn = i % 2 === 0
        ? page.locator('.swipe-buttons button').last()
        : page.locator('.swipe-buttons button').first();
      await btn.tap();
      await page.waitForTimeout(400);
    }
    const text = await page.locator('#swipe-progress-text').textContent();
    expect(text).toMatch(/^5\s*\/\s*\d+$/);
    const cardCount = await page.locator('.swipe-card').count();
    expect(cardCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════
//  CROSS-DEVICE TESTS
// ═══════════════════════════════════════════════════

test.describe('Cross-device - use.html', () => {
  test('no 404 resources', async ({ page }) => {
    const failedResources = [];
    page.on('response', response => {
      if (response.status() >= 400 && !response.url().includes('/api/')) {
        failedResources.push({ url: response.url(), status: response.status() });
      }
    });
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    expect(failedResources, `Failed resources:\n${JSON.stringify(failedResources, null, 2)}`).toHaveLength(0);
  });

  test('page title is correct', async ({ page }) => {
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/Use Cases.*tinyNature/i);
  });

  test('no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text());
      }
    });
    await page.goto('/use.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
