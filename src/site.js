const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

const COURSES = config.site.courses;

let _screenshotDirEnsured = false;

class SiteAutomation {
  constructor({ email, password } = {}) {
    this.email = email || config.email;
    this.password = password || config.password;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init() {
    logger.info('Launching browser...');
    this.browser = await chromium.launch({
      headless: process.env.HEADLESS === 'true',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      timezoneId: config.timezone,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30000);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async screenshot(name) {
    const dir = config.screenshotDir;
    if (!_screenshotDirEnsured) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      _screenshotDirEnsured = true;
    }
    const filePath = path.join(dir, `${name}-${Date.now()}.png`);
    await this.page.screenshot({ path: filePath, fullPage: true });
    logger.debug(`Screenshot saved: ${filePath}`);
    return filePath;
  }

  async navigateToBooking(courseId, date) {
    const url = `${config.site.memberUrl}/teetimes?course=${courseId}&date=${date}`;
    logger.info(`Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await this.page.waitForTimeout(3000);

    try {
      const teeTimesNav = await this.page.$('a:has-text("Tee Times"), button:has-text("Tee Times")');
      if (teeTimesNav && await teeTimesNav.isVisible()) {
        await teeTimesNav.click();
        await this.page.waitForTimeout(3000);
        logger.info('Clicked Tee Times nav link');
      }
    } catch {                                 }
  }

  async login() {
    logger.info('Starting login process...');

    const loginSelectors = [
      'button:has-text("Sign In")',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'a:has-text("Sign In")',
      'a:has-text("Log In")',
      '[data-testid="login-button"]',
      '.login-btn',
      '.sign-in-btn',
      '#loginButton',
    ];

    let loginClicked = false;
    for (const sel of loginSelectors) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          logger.info(`Found login trigger: ${sel}`);
          await el.click();
          loginClicked = true;
          break;
        }
      } catch {

      }
    }

    if (!loginClicked) {

      logger.info('No login button found — checking if login form is already visible...');
    }

    await this.page.waitForTimeout(2000);

    const frame = await this._findLoginFrame();
    const loginContext = frame || this.page;

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      '#email',
      '#username',
      'input[placeholder*="email" i]',
      'input[placeholder*="Email" i]',
    ];

    let emailField = null;
    for (const sel of emailSelectors) {
      try {
        emailField = await loginContext.waitForSelector(sel, { timeout: 5000 });
        if (emailField) {
          logger.info(`Found email field: ${sel}`);
          break;
        }
      } catch {

      }
    }

    if (!emailField) {
      await this.screenshot('login-no-email-field');
      throw new Error('Could not find email input field on login page');
    }

    await emailField.fill(this.email);
    logger.info(`Email entered: ${this.email}`);
    logger.debug(`Password length: ${this.password.length}`);

    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      '#password',
    ];

    let passwordField = null;
    for (const sel of passwordSelectors) {
      try {
        passwordField = await loginContext.$(sel);
        if (passwordField) break;
      } catch {

      }
    }

    if (!passwordField) {
      await this.screenshot('login-no-password-field');
      throw new Error('Could not find password input field');
    }

    await passwordField.fill(this.password);
    logger.info('Password entered');

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Sign In")',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'input[type="submit"]',
    ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = await loginContext.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click();
          submitted = true;
          logger.info(`Login submitted via: ${sel}`);
          break;
        }
      } catch {

      }
    }

    if (!submitted) {

      await passwordField.press('Enter');
      logger.info('Login submitted via Enter key');
    }

    await this.page.waitForTimeout(5000);

    try {
      const verifyEl = await loginContext.$('text=verify your email');
      if (verifyEl) {
        logger.info('Email verification prompt detected — attempting to dismiss...');
        await this.screenshot('login-verify-prompt');

        const dismissSelectors = [
          'button:has-text("Continue")',
          'button:has-text("Close")',
          'button:has-text("OK")',
          'button:has-text("Skip")',
          'button:has-text("Later")',
          '[class*="close"]',
          '[aria-label="Close"]',
          'button:has-text("Send Email")',
        ];
        for (const sel of dismissSelectors) {
          try {
            const btn = await loginContext.$(sel);
            if (btn && await btn.isVisible()) {
              await btn.click();
              logger.info(`Clicked dismiss button: ${sel}`);
              break;
            }
          } catch {                }
        }

        try {
          await this.page.click('body', { position: { x: 640, y: 10 } });
        } catch {              }
        await this.page.waitForTimeout(3000);
      }
    } catch {                              }

    const errorSelectors = [
      'text=could not authenticate',
      'text=invalid credentials',
      'text=incorrect password',
      'text=account not found',
    ];
    for (const sel of errorSelectors) {
      try {
        const errEl = await loginContext.$(sel);
        if (errEl && await errEl.isVisible()) {
          const errText = await errEl.textContent();
          await this.screenshot('login-auth-error');
          throw new Error(`Login rejected by site: "${errText.trim()}". Check your GOLF_EMAIL and GOLF_PASSWORD in .env`);
        }
      } catch (e) {
        if (e.message.startsWith('Login rejected')) throw e;
      }
    }

    await this._checkForBlocks();

    await this.page.waitForTimeout(3000);
    const loggedIn = await this._verifyLoggedIn();
    if (!loggedIn) {

      await this.screenshot('login-status-unclear');
      logger.warn('Could not confirm login status — proceeding anyway to check if booking page is accessible');
    }

    logger.info('Login successful');
  }

  async _findLoginFrame() {
    const frames = this.page.frames();
    for (const frame of frames) {
      try {
        const hasEmail = await frame.$('input[type="email"], input[name="email"]');
        if (hasEmail) {
          logger.info('Found login form in iframe');
          return frame;
        }
      } catch {

      }
    }
    return null;
  }

  async _clickCartIcon() {

    await this._dismissModals();

    const cartSelectors = [
      'header [aria-label*="cart" i]',
      'header button[aria-label*="cart" i]',
      'nav [aria-label*="cart" i]',
      '[class*="header"] [aria-label*="cart" i]',
      'button[aria-label="cart"]',
      'button[aria-label="Cart"]',
      '[data-testid="ShoppingCartIcon"]',
      'svg[data-testid="ShoppingCartIcon"]',
    ];

    for (const sel of cartSelectors) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          const clickTarget = await el.evaluate(e => {
            const btn = e.closest('button') || e.closest('a') || e;
            btn.click();
            return btn.tagName;
          });
          logger.info(`Clicked cart icon via: ${sel} (${clickTarget})`);
          await this.page.waitForTimeout(2000);
          return true;
        }
      } catch {                }
    }

    try {
      const badgeClicked = await this.page.evaluate(() => {

        const badges = document.querySelectorAll('.MuiBadge-root, [class*="Badge"]');
        for (const badge of badges) {
          const rect = badge.getBoundingClientRect();

          if (rect.top < 60 && rect.left > window.innerWidth * 0.8 && rect.width > 0) {
            const clickTarget = badge.closest('button') || badge.closest('a') || badge;
            clickTarget.click();
            return true;
          }
        }
        return false;
      });
      if (badgeClicked) {
        logger.info('Clicked cart icon via MuiBadge in header');
        await this.page.waitForTimeout(2000);
        return true;
      }
    } catch {              }

    try {
      const clicked = await this.page.evaluate(() => {

        const headerEls = document.querySelectorAll('header button, header a, header svg, nav button, nav a');
        let rightmost = null;
        let maxRight = 0;

        for (const el of headerEls) {
          const rect = el.getBoundingClientRect();
          if (rect.top < 60 && rect.height > 0 && rect.width > 0 && rect.width < 80) {

            if (rect.right > maxRight) {
              maxRight = rect.right;
              rightmost = el;
            }
          }
        }

        if (rightmost) {
          const clickTarget = rightmost.closest('button') || rightmost.closest('a') || rightmost;
          clickTarget.click();
          return true;
        }
        return false;
      });
      if (clicked) {
        logger.info('Clicked rightmost header element (cart icon)');
        await this.page.waitForTimeout(2000);
        return true;
      }
    } catch {              }

    logger.warn('Could not find cart icon in header');
    return false;
  }

  async _dismissModals() {
    try {

      const backdrop = await this.page.$('.MuiBackdrop-root');
      if (backdrop) {
        await backdrop.click({ force: true });
        await this.page.waitForTimeout(500);
        logger.debug('Dismissed MUI backdrop');
      }

      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);

      const closeBtn = await this.page.$('[aria-label="Close"], button:has-text("×"), .MuiAlert-action button');
      if (closeBtn && await closeBtn.isVisible()) {
        await closeBtn.click({ force: true });
        await this.page.waitForTimeout(500);
        logger.debug('Dismissed alert/banner');
      }
    } catch {

    }
  }

  async _checkForBlocks() {
    const blockIndicators = [
      'text=captcha',
      'text=CAPTCHA',
      'text=blocked',
      'text=Access Denied',
      'text=Rate Limited',
      '.g-recaptcha',
      '#captcha',
      'iframe[src*="recaptcha"]',
      'iframe[src*="captcha"]',
    ];

    for (const sel of blockIndicators) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          const screenshotPath = await this.screenshot('blocked-captcha');
          throw new Error(
            `BLOCKED: Security challenge detected (${sel}). ` +
            `Screenshot: ${screenshotPath}. Bot stopping — manual intervention required.`
          );
        }
      } catch (e) {
        if (e.message.startsWith('BLOCKED')) throw e;
      }
    }
  }

  async _verifyLoggedIn() {

    const indicators = [
      'text=Welcome',
      'text=Sign Out',
      'text=Log Out',
      'text=My Account',
      'text=Book',
      '[data-testid="user-menu"]',
      '.user-info',
      '.logged-in',
    ];

    for (const sel of indicators) {
      try {
        const el = await this.page.$(sel);
        if (el) return true;
      } catch {

      }
    }

    try {
      const teeTimeEl = await this.page.$('.tee-time, [class*="teeTime"], [class*="TeeTime"]');
      if (teeTimeEl) return true;
    } catch {

    }

    return false;
  }

  async selectCourse(courseName = 'Pines') {
    const target = courseName === 'Oaks' ? COURSES.oaks : COURSES.pines;
    const targetRegex = new RegExp(courseName, 'i');
    logger.info(`Selecting course: ${courseName}...`);

    const courseSelectors = [
      'select[name*="course" i]',
      'select[id*="course" i]',
      '[class*="course-select" i]',
      '[class*="courseSelect" i]',
      '[data-testid*="course" i]',
    ];

    for (const sel of courseSelectors) {
      try {
        const dropdown = await this.page.$(sel);
        if (dropdown) {
          try {
            await dropdown.selectOption({ label: targetRegex });
            logger.info(`Selected ${courseName} course via dropdown`);
            return target.id;
          } catch {
            try {
              await dropdown.selectOption(target.id);
              logger.info(`Selected ${courseName} course via dropdown (by value)`);
              return target.id;
            } catch {
              logger.warn(`${courseName} not available in dropdown`);
            }
          }
        }
      } catch {

      }
    }

    const filterSel = `button:has-text("${courseName} Course"), button:has-text("${courseName}"), a:has-text("${courseName}"), [class*="tab"]:has-text("${courseName}")`;
    const filter = await this.page.$(filterSel);
    if (filter && await filter.isVisible()) {
      const isActive = await filter.evaluate(el => el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true' || el.style.backgroundColor !== '');
      if (!isActive) {
        await filter.click();
        await this.page.waitForTimeout(2000);
      }
      logger.info(`Selected ${courseName} course via filter`);
      return target.id;
    }

    logger.info(`No course selector found — ${courseName} may be set via URL`);
    return target.id;
  }

  async _prepareForBooking() {
    await this._dismissModals();

    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(1000);
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);
  }

  async selectDate(dateStr) {
    logger.info(`Selecting date: ${dateStr}`);

    const currentUrl = this.page.url();
    if (!currentUrl.includes(`date=${dateStr}`)) {
      const url = new URL(currentUrl);
      url.searchParams.set('date', dateStr);
      await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.page.waitForTimeout(3000);
    }

    const datePickerSelectors = [
      `[data-date="${dateStr}"]`,
      `button:has-text("${this._formatDateForPicker(dateStr)}")`,
      `td:has-text("${parseInt(dateStr.split('-')[2])}")`,
    ];

    for (const sel of datePickerSelectors) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          await this.page.waitForTimeout(2000);
          logger.info(`Clicked date picker element: ${sel}`);
          break;
        }
      } catch {

      }
    }
  }

  _formatDateForPicker(dateStr) {
    const [y, m, d] = dateStr.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m) - 1]} ${parseInt(d)}`;
  }

  async getAvailableTeeTimes() {
    logger.info('Scanning for available tee times...');

    await this.page.waitForTimeout(3000);
    await this._prepareForBooking();
    await this.screenshot('tee-times-page');

    const bookButtons = await this.page.$$('button:has-text("Book Now"), button:has-text("BOOK NOW")');
    logger.info(`Found ${bookButtons.length} "Book Now" buttons`);

    if (bookButtons.length === 0) {
      logger.warn('No Book Now buttons found on page');
      await this.screenshot('no-tee-times-found');
      return [];
    }

    const teeTimes = [];
    for (const btn of bookButtons) {
      try {

        const cardText = await btn.evaluate(el => {
          let node = el.parentElement;

          for (let i = 0; i < 3; i++) {
            if (!node) break;
            const text = node.textContent || '';

            if (/\d{1,2}:\d{2}\s*(AM|PM)/i.test(text) && text.length < 300) {
              return text;
            }
            node = node.parentElement;
          }

          return el.parentElement?.parentElement?.textContent || '';
        });

        logger.debug(`Card text: "${cardText.trim().slice(0, 120)}"`);
        const time = this._extractTime(cardText);
        if (time) {

          const playerMatch = cardText.match(/\b(\d)\s*[-–]\s*(\d)\b/);
          const maxPlayers = playerMatch ? parseInt(playerMatch[2], 10) : 4;
          if (maxPlayers < 4) {
            logger.info(`  Skipping ${time} — max players on this slot is ${maxPlayers} (need 4)`);
            continue;
          }
          teeTimes.push({
            time,
            text: cardText.trim(),
            element: btn,
          });
          logger.info(`  Found tee time: ${time}`);
        }
      } catch (e) {
        logger.debug(`  Error reading card: ${e.message}`);
      }
    }

    logger.info(`Parsed ${teeTimes.length} tee times`);
    return teeTimes;
  }

  _extractTime(text) {

    const match = text.match(/(\d{1,2}:\d{2})\s*(AM|PM|am|pm)?/);
    if (!match) return null;

    let [, time, period] = match;
    if (period) {

      let [h, m] = time.split(':').map(Number);
      if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
      if (period.toUpperCase() === 'AM' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return time;
  }

  findConsecutiveSlots(teeTimes, windowStart, windowEnd, slotsNeeded) {
    const winStartMin = this._timeToMinutes(windowStart);
    const winEndMin = this._timeToMinutes(windowEnd);

    const sorted = [...teeTimes].sort(
      (a, b) => this._timeToMinutes(a.time) - this._timeToMinutes(b.time)
    );

    const candidates = sorted.filter(t => {
      const mins = this._timeToMinutes(t.time);
      return mins >= winStartMin && mins <= winEndMin;
    });

    for (const candidate of candidates) {
      const idx = sorted.indexOf(candidate);
      const consecutive = this._getConsecutiveFrom(sorted, idx, slotsNeeded);
      if (consecutive) {

        const lastMin = this._timeToMinutes(consecutive[consecutive.length - 1].time);
        if (lastMin <= winEndMin) {
          logger.info(`Found ${slotsNeeded} consecutive slots in ${windowStart}-${windowEnd}: ${consecutive.map(t => t.time).join(', ')}`);
          return consecutive;
        }
      }
    }

    logger.warn(`Could not find ${slotsNeeded} consecutive slots in window ${windowStart}-${windowEnd}`);
    return [];
  }

  findSlotsInWindow(teeTimes, windowStart, windowEnd, maxSlots) {
    const winStartMin = this._timeToMinutes(windowStart);
    const winEndMin = this._timeToMinutes(windowEnd);

    const sorted = [...teeTimes].sort(
      (a, b) => this._timeToMinutes(a.time) - this._timeToMinutes(b.time)
    );

    const inWindow = sorted.filter(t => {
      const mins = this._timeToMinutes(t.time);
      return mins >= winStartMin && mins <= winEndMin;
    });

    return inWindow.slice(0, maxSlots);
  }

  _getConsecutiveFrom(sorted, startIdx, count) {
    if (startIdx + count > sorted.length) return null;

    const slots = sorted.slice(startIdx, startIdx + count);

    for (let i = 1; i < slots.length; i++) {
      const diff = this._timeToMinutes(slots[i].time) - this._timeToMinutes(slots[i - 1].time);
      if (diff < 5 || diff > 15) return null;
    }
    return slots;
  }

  _timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  async bookSlot(teeTimeEl, slotIndex) {
    logger.info(`Booking slot ${slotIndex}...`);

    try {

      await this._dismissModals();

      await teeTimeEl.evaluate(el => {
        el.scrollIntoView({ block: 'center' });
      });
      await this.page.waitForTimeout(500);
      await teeTimeEl.evaluate(el => el.click());
      logger.info(`Clicked "Book Now" for slot ${slotIndex}`);

      try {
        await this.page.waitForFunction(() => {
          return document.body.innerText.includes('Select Number of Golfers');
        }, { timeout: 10000 });
        logger.info('Booking modal fully loaded');
      } catch {
        logger.warn('Timed out waiting for golfer selection to appear in modal');
      }
      await this.screenshot(`slot-${slotIndex}-after-click`);

      const golferResult = await this.page.evaluate((desiredCount) => {

        const allEls = document.querySelectorAll('*');
        let golferSection = null;
        for (const el of allEls) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ');
          if (/Select Number of Golfers/i.test(ownText)) {
            golferSection = el;
            break;
          }
          if (el.children.length === 0 && /Select Number of Golfers/i.test(el.textContent.trim())) {
            golferSection = el;
            break;
          }
        }

        if (!golferSection) {
          return { error: 'Could not find "Select Number of Golfers" heading', selectedCount: 0 };
        }

        const golferBtns = {};
        let container = golferSection.parentElement;
        for (let depth = 0; depth < 6 && container; depth++, container = container.parentElement) {
          const radioGroup = container.querySelector('[role="radiogroup"]');
          if (radioGroup) {

            const allDescendants = radioGroup.querySelectorAll('*');
            for (const el of allDescendants) {

              if (el.children.length > 2) continue;
              const text = el.textContent.trim();
              if (text.length > 3) continue;
              const num = parseInt(text, 10);
              if (num >= 1 && num <= 4 && String(num) === text) {
                const isMuiRadio = el.classList.contains('MuiButtonBase-root') ||
                  el.classList.contains('MuiRadio-root');
                const isDisabled = el.classList.contains('Mui-disabled') ||
                  (el.closest && el.closest('.Mui-disabled') !== null) ||
                  parseFloat(getComputedStyle(el).opacity) < 0.4;

                if (!golferBtns[num] || isMuiRadio) {
                  golferBtns[num] = { el, disabled: isDisabled };
                }
              }
            }
            if (Object.keys(golferBtns).length >= 2) break;
          }

          const buttons = container.querySelectorAll('button, [role="button"]');
          for (const el of buttons) {
            const text = el.textContent.trim().replace(/[\s\u200b\u00a0]+/g, '');
            const num = parseInt(text, 10);
            if (num >= 1 && num <= 4 && text.length <= 3 && !golferBtns[num]) {
              const isDisabled = el.disabled ||
                el.getAttribute('aria-disabled') === 'true' ||
                parseFloat(getComputedStyle(el).opacity) < 0.4;
              golferBtns[num] = { el, disabled: isDisabled };
            }
          }
          if (Object.keys(golferBtns).length >= 2) break;
        }

        if (Object.keys(golferBtns).length === 0) {
          let debugContainer = golferSection.parentElement;
          const debugInfo = [];
          for (let d = 0; d < 4 && debugContainer; d++, debugContainer = debugContainer.parentElement) {
            const children = debugContainer.querySelectorAll('*');
            for (const child of children) {
              const text = child.textContent.trim();
              if (text.length <= 5 && /^\d+$/.test(text.replace(/\s/g, ''))) {
                debugInfo.push({
                  tag: child.tagName,
                  text,
                  classes: (child.className && typeof child.className === 'string') ? child.className.substring(0, 100) : '',
                  role: child.getAttribute('role') || '',
                });
              }
            }
          }
          return {
            error: 'Found heading but no golfer buttons nearby',
            selectedCount: 1,
            headingTag: golferSection.tagName,
            debug: debugInfo.slice(0, 20),
          };
        }

        const preferenceOrder = [4];
        for (const count of preferenceOrder) {
          if (golferBtns[count] && !golferBtns[count].disabled) {
            const btn = golferBtns[count].el;

            const fireReactClick = (target) => {

              const radioInput = target.querySelector('input[type="radio"]') ||
                (target.tagName === 'INPUT' && target.type === 'radio' ? target : null);
              if (radioInput) {

                radioInput.focus();
                radioInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                radioInput.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                radioInput.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                radioInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                return true;
              }

              target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return false;
            };

            const usedRadioInput = fireReactClick(btn);
            return { selectedCount: count, found: Object.keys(golferBtns).map(Number), usedRadioInput };
          }
        }

        const availableCounts = Object.entries(golferBtns)
          .filter(([, v]) => !v.disabled)
          .map(([k]) => Number(k));
        return {
          error: 'No golfer count available on this tee time',
          selectedCount: 0,
          availableCounts,
          found: Object.keys(golferBtns).map(Number),
        };
      }, 4);

      if (golferResult.error || golferResult.selectedCount !== 4) {
        const avail = golferResult.availableCounts || [];
        logger.warn(
          `Slot ${slotIndex}: ${golferResult.error || 'no spots available'} ` +
          `(available: [${avail.join(', ')}]) — skipping this tee time`
        );
        if (golferResult.debug) {
          logger.warn(`Debug — nearby numeric elements: ${JSON.stringify(golferResult.debug)}`);
        }
        const screenshotPath = await this.screenshot(`slot-${slotIndex}-insufficient-spots`);
        await this._dismissModals();
        return {
          success: false,
          error: golferResult.error || 'No spots available',
          screenshotPath,
        };
      }

      logger.info(`Selected ${golferResult.selectedCount} golfers in modal (buttons found: ${golferResult.found}, usedRadioInput: ${golferResult.usedRadioInput})`);

      await this.page.waitForTimeout(1500);

      const verifyResult = await this.page.evaluate(() => {
        const allEls = document.querySelectorAll('*');
        let golferSection = null;
        for (const el of allEls) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ');
          if (/Select Number of Golfers/i.test(ownText)) { golferSection = el; break; }
          if (el.children.length === 0 && /Select Number of Golfers/i.test(el.textContent.trim())) { golferSection = el; break; }
        }
        if (!golferSection) return { verified: false, reason: 'heading not found' };
        let container = golferSection.parentElement;
        for (let depth = 0; depth < 6 && container; depth++, container = container.parentElement) {
          const radioGroup = container.querySelector('[role="radiogroup"]');
          if (radioGroup) {
            const checkedInput = radioGroup.querySelector('input[type="radio"]:checked');
            if (checkedInput) {

              const val = parseInt(checkedInput.value, 10);
              const labelText = checkedInput.closest('label') ?
                checkedInput.closest('label').textContent.trim() : null;
              return { verified: true, selectedValue: val || null, labelText };
            }

            const ariaChecked = radioGroup.querySelector('[aria-checked="true"]');
            if (ariaChecked) {
              const text = ariaChecked.textContent.trim();
              const val = parseInt(text, 10);
              return { verified: true, selectedValue: val || null, ariaChecked: text };
            }
            return { verified: false, reason: 'no checked radio found in radiogroup' };
          }
        }
        return { verified: false, reason: 'radiogroup not found' };
      });

      logger.info(`Player count verification: ${JSON.stringify(verifyResult)}`);

      if (!verifyResult.verified || verifyResult.selectedValue !== 4) {
        logger.warn(`Player count not confirmed as 4 after in-page dispatchEvent — retrying with Playwright native click`);
        try {

          let clicked = false;
          const radioInputs = await this.page.locator('[role="radiogroup"] input[type="radio"]').all();
          for (const inp of radioInputs) {
            const val = await inp.getAttribute('value').catch(() => null);
            const labelEl = await inp.evaluate(el => {
              const label = el.closest('label');
              return label ? label.textContent.trim() : (el.parentElement ? el.parentElement.textContent.trim() : '');
            });
            const num = parseInt(val || labelEl, 10);
            if (num === 4) {
              await inp.click({ force: true });
              logger.info('Playwright native click on 4-player radio input succeeded');
              clicked = true;
              break;
            }
          }
          if (!clicked) {

            const fourLocator = this.page.locator('[role="radiogroup"]').locator('text="4"').first();
            await fourLocator.click({ force: true });
            logger.info('Playwright native click on "4" text within radiogroup succeeded');
          }
          await this.page.waitForTimeout(1000);
        } catch (retryErr) {
          logger.warn(`Playwright native click retry failed: ${retryErr.message}`);
        }
      }

      await this.screenshot(`slot-${slotIndex}-players-set`);

      let addedToCart = false;
      const addResult = await this.page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.offsetParent === null) continue;
          const text = btn.textContent.trim().replace(/[\s\u200b]+/g, ' ').toUpperCase();
          if (text === 'ADD TO CART') {

            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return { found: true, text: btn.textContent.trim() };
          }
        }
        return { found: false };
      });

      if (addResult.found) {
        addedToCart = true;
        logger.info(`Clicked "ADD TO CART" button`);
        await this.page.waitForTimeout(3000);
        await this.screenshot(`slot-${slotIndex}-after-add-to-cart`);
      }

      if (!addedToCart) {
        logger.warn('ADD TO CART button not found after golfer selection');
        const screenshotPath = await this.screenshot(`slot-${slotIndex}-no-add-to-cart`);
        return { success: false, error: 'ADD TO CART button not found', screenshotPath };
      }

      const cartError = await this.page.evaluate(() => {
        const text = document.body.innerText;
        if (/cart items limit exceeded/i.test(text) || /cart.*limit/i.test(text) || /cart.*full/i.test(text)) {
          return 'Cart items limit exceeded';
        }
        return null;
      });
      if (cartError) {
        logger.warn(`Cart error after ADD TO CART: ${cartError}`);
        await this.screenshot(`slot-${slotIndex}-cart-limit`);
        return { success: false, error: cartError, screenshotPath: null };
      }

      logger.info(`Slot ${slotIndex} added to cart successfully`);
      const screenshotPath = await this.screenshot(`slot-${slotIndex}-in-cart`);
      return { success: true, confirmationNumber: 'ADDED_TO_CART', error: null, screenshotPath, selectedCount: golferResult.selectedCount };

    } catch (error) {
      const screenshotPath = await this.screenshot(`slot-${slotIndex}-error`);
      logger.error(`Error booking slot ${slotIndex}: ${error.message}`);
      return { success: false, error: error.message, screenshotPath };
    }
  }

  async _setPlayerCount(count) {

    const modalButtons = new Map();

    const buttonInfos = await this.page.evaluate(() => {

      const allEls = document.querySelectorAll('*');
      let golferSection = null;
      for (const el of allEls) {
        const ownText = Array.from(el.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .join(' ');
        if (/Select Number of Golfers/i.test(ownText)) { golferSection = el; break; }
        if (el.children.length === 0 && /Select Number of Golfers/i.test(el.textContent.trim())) { golferSection = el; break; }
      }
      if (!golferSection) return [];

      let container = golferSection.parentElement;
      const results = [];
      for (let depth = 0; depth < 4 && container; depth++, container = container.parentElement) {
        const btns = container.querySelectorAll('button');
        for (const btn of btns) {
          const text = btn.textContent.trim();
          const num = parseInt(text, 10);
          if (num >= 1 && num <= 4 && String(num) === text) {
            const isDisabled = btn.disabled ||
              btn.getAttribute('aria-disabled') === 'true' ||
              getComputedStyle(btn).pointerEvents === 'none' ||
              parseFloat(getComputedStyle(btn).opacity) < 0.5;
            results.push({ num, disabled: isDisabled });
          }
        }
        if (results.length >= 2) break;
      }
      return results;
    });

    const allButtons = await this.page.$$('button');
    const handledNums = new Set();
    for (const btn of allButtons) {
      const info = await btn.evaluate(el => {
        const text = el.textContent.trim();
        const num = parseInt(text, 10);
        if (num >= 1 && num <= 4 && String(num) === text) return num;
        return null;
      }).catch(() => null);
      if (info !== null && buttonInfos.some(bi => bi.num === info) && !handledNums.has(info)) {

        const isInSection = await btn.evaluate(el => {
          let node = el.parentElement;
          for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
            const text = Array.from(node.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim()).join('');
            if (node.querySelector && Array.from(node.querySelectorAll('*')).some(child =>
              child.children.length === 0 && /Select Number of Golfers/i.test(child.textContent.trim())
            )) return true;
          }
          return false;
        }).catch(() => false);
        if (isInSection) {
          const bi = buttonInfos.find(b => b.num === info);
          modalButtons.set(info, { handle: btn, disabled: bi?.disabled || false });
          handledNums.add(info);
        }
      }
    }

    if (modalButtons.size === 0) {
      logger.warn('No golfer count buttons found in modal — proceeding with default');
      return count;
    }

    const tryOrder = [];
    for (let n = count; n >= 2; n--) tryOrder.push(n);

    for (const n of tryOrder) {
      const entry = modalButtons.get(n);
      if (!entry) continue;
      if (entry.disabled) {
        logger.info(`Golfer button ${n} is disabled — trying lower count`);
        continue;
      }
      await entry.handle.evaluate(el => el.click());
      if (n < count) {
        logger.warn(`Set ${n} golfers (wanted ${count} but higher counts disabled)`);
      } else {
        logger.info(`Set ${count} golfers via modal button`);
      }
      return n;
    }

    logger.warn(`All golfer count buttons disabled — proceeding with default`);
    return 1;
  }

  async _extractConfirmation() {

    try {
      const confirmation = await this.page.evaluate(() => {
        const text = document.body.innerText;

        const resMatch = text.match(/Reservation\s*#\s*(\d+)/i);
        if (resMatch) return resMatch[1];

        const patterns = [
          /confirmation\s*(?:#|number|:)\s*([A-Z0-9-]{6,})/i,
          /booking\s*(?:#|number|:)\s*([A-Z0-9-]{6,})/i,
          /order\s*(?:#|number|:)\s*([A-Z0-9-]{6,})/i,
          /receipt\s*(?:#|number|:)\s*([A-Z0-9-]{6,})/i,
        ];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) return match[1];
        }
        return null;
      });
      if (confirmation) {
        logger.info(`Extracted reservation number: ${confirmation}`);
        return confirmation;
      }
    } catch (e) {
      logger.warn(`Error extracting confirmation: ${e.message}`);
    }

    logger.warn('Could not extract reservation number from confirmation page');
    return null;
  }

  async clearCart() {
    logger.info('Clearing stale cart items...');

    let cartOpened = await this._clickCartIcon();

    if (!cartOpened) {
      logger.info('Could not find cart icon — cart likely empty');
      return;
    }

    await this.screenshot('clear-cart-opened');

    let editCartClicked = false;
    const editCartSelectors = [
      'button:has-text("EDIT CART")',
      'button:has-text("Edit Cart")',
      'a:has-text("EDIT CART")',
      'a:has-text("Edit Cart")',
    ];
    for (const sel of editCartSelectors) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          await el.evaluate(e => e.click());
          logger.info(`Clicked "${sel}" to enter edit mode`);
          editCartClicked = true;
          await this.page.waitForTimeout(2000);
          break;
        }
      } catch {                }
    }

    if (!editCartClicked) {
      logger.info('No "EDIT CART" button found — cart may be empty or already in edit mode');
    }

    await this.screenshot('clear-cart-edit-mode');

    let itemsRemoved = 0;
    const maxItems = 10;

    for (let attempt = 0; attempt < maxItems; attempt++) {
      const removed = await this.page.evaluate(() => {

        const deleteSelectors = [
          '[aria-label*="delete" i]',
          '[aria-label*="remove" i]',
          '[aria-label*="trash" i]',
          '[class*="delete" i]',
          '[class*="remove" i]',
          '[class*="trash" i]',
          'button svg[data-testid="DeleteIcon"]',
          'button svg[data-testid="DeleteOutlineIcon"]',
          'button svg[data-testid="CloseIcon"]',
        ];

        for (const sel of deleteSelectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (el.offsetParent !== null) {
              const clickTarget = el.closest('button') || el.closest('a') || el;
              clickTarget.click();
              return `clicked-delete: ${sel}`;
            }
          }
        }

        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent.trim().toUpperCase();
          if ((text === '' || text === 'REMOVE' || text === 'DELETE' || text === '×' || text === 'X') && btn.offsetParent !== null) {

            const parent = btn.closest('[class*="cart" i], [class*="Cart" i], [class*="Shopping" i], [class*="drawer" i], [class*="Drawer" i], [class*="panel" i]');
            if (parent) {
              btn.click();
              return 'clicked-cart-button';
            }
          }
        }

        return null;
      });

      if (!removed) {

        break;
      }

      logger.info(`Cart item removal: ${removed}`);
      await this.page.waitForTimeout(2000);
      await this.screenshot(`clear-cart-removed-${itemsRemoved}`);
      itemsRemoved++;
    }

    if (itemsRemoved > 0) {
      logger.info(`Removed ${itemsRemoved} stale cart item(s)`);
      await this.screenshot('clear-cart-done');
    } else {
      logger.info('Cart was empty — nothing to clear');
    }

    await this._dismissModals();
    await this.page.waitForTimeout(500);
  }

  async completeCheckout() {
    logger.info('Completing checkout...');
    await this.page.waitForTimeout(2000);

    await this._dismissModals();
    await this.screenshot('checkout-before-cart');

    let navigatedToCheckout = false;

    const checkoutBtnSelectors = [
      'button:has-text("Checkout")',
      'a:has-text("Checkout")',
      'button:has-text("CHECKOUT")',
      'a:has-text("CHECKOUT")',
      'button:has-text("Proceed to Checkout")',
      'a:has-text("Proceed to Checkout")',
    ];

    for (const sel of checkoutBtnSelectors) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          await el.evaluate(e => e.click());
          logger.info(`CHECKOUT button already visible — clicked: ${sel}`);
          navigatedToCheckout = true;
          await this.page.waitForTimeout(3000);
          break;
        }
      } catch {                }
    }

    if (!navigatedToCheckout) {
      const cartOpened = await this._clickCartIcon();
      await this.screenshot('checkout-after-cart-icon');

      if (cartOpened) {

        for (const sel of checkoutBtnSelectors) {
          try {
            const el = await this.page.$(sel);
            if (el && await el.isVisible()) {
              await el.evaluate(e => e.click());
              logger.info(`Clicked checkout button: ${sel}`);
              navigatedToCheckout = true;
              await this.page.waitForTimeout(3000);
              break;
            }
          } catch {                }
        }

        if (!navigatedToCheckout) {
          logger.warn('CHECKOUT not found after cart click — retrying');
          await this._clickCartIcon();
          await this.page.waitForTimeout(1000);
          for (const sel of checkoutBtnSelectors) {
            try {
              const el = await this.page.$(sel);
              if (el && await el.isVisible()) {
                await el.evaluate(e => e.click());
                logger.info(`Clicked checkout on retry: ${sel}`);
                navigatedToCheckout = true;
                await this.page.waitForTimeout(3000);
                break;
              }
            } catch {                }
          }
        }
      }
    }

    if (!navigatedToCheckout) {
      logger.warn('Could not navigate to checkout — CHECKOUT button never found');
      await this.screenshot('checkout-not-found');
      return { success: false, error: 'Could not reach checkout page', screenshotPath: null };
    }

    await this.page.waitForTimeout(1000);
    const onCheckoutPage = await this.page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('CHECKOUT') && (text.includes('Review Items') || text.includes('Summary') || text.includes('Terms and Conditions') || text.includes('Complete your purchase'));
    });
    if (!onCheckoutPage) {
      logger.warn('Not on checkout page after clicking CHECKOUT');
      await this.screenshot('checkout-wrong-page');
      return { success: false, error: 'Did not reach checkout page', screenshotPath: null };
    }

    logger.info('On checkout page');
    await this.screenshot('checkout-page');

    await this._dismissModals();
    await this.page.waitForTimeout(1000);

    let termsChecked = false;

    const termsResult = await this.page.evaluate(() => {

      const allElements = document.querySelectorAll('label, span, div, p');
      for (const el of allElements) {
        const text = (el.textContent || '').trim();

        if (!/i agree/i.test(text) || text.length > 200) continue;

        let checkbox = el.querySelector('input[type="checkbox"]');
        if (!checkbox) {

          const label = el.closest('label');
          if (label) checkbox = label.querySelector('input[type="checkbox"]');
        }
        if (!checkbox) {

          const parent = el.parentElement;
          if (parent) checkbox = parent.querySelector('input[type="checkbox"]');
        }

        if (checkbox) {
          if (!checkbox.checked) {

            checkbox.click();
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            checkbox.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return { method: 'checkbox-near-i-agree', checked: checkbox.checked };
        }

        if (el.tagName === 'LABEL' || el.closest('label')) {
          const labelEl = el.tagName === 'LABEL' ? el : el.closest('label');
          labelEl.click();

          const cb = labelEl.querySelector('input[type="checkbox"]');
          return { method: 'clicked-i-agree-label', checked: cb ? cb.checked : 'unknown' };
        }
      }

      const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
      const unchecked = checkboxes.filter(cb => !cb.checked);
      if (unchecked.length > 0) {

        const lastUnchecked = unchecked[unchecked.length - 1];
        lastUnchecked.click();
        lastUnchecked.dispatchEvent(new Event('change', { bubbles: true }));
        lastUnchecked.dispatchEvent(new Event('input', { bubbles: true }));
        return { method: 'last-unchecked-checkbox', checked: lastUnchecked.checked };
      }

      const allChecked = checkboxes.every(cb => cb.checked);
      if (checkboxes.length > 0 && allChecked) {
        return { method: 'all-already-checked', checked: true };
      }

      return null;
    });

    if (termsResult) {
      logger.info(`Terms and Conditions: ${termsResult.method} (checked: ${termsResult.checked})`);
      termsChecked = termsResult.checked === true || termsResult.checked === 'unknown';
      await this.page.waitForTimeout(1000);

      if (!termsChecked) {
        logger.warn('Terms checkbox click did not register — trying Playwright locator approach');
        try {

          const agreeLocator = this.page.locator('text=I agree to the Terms').locator('xpath=ancestor::label[1]//input[@type="checkbox"]');
          if (await agreeLocator.count() > 0) {
            await agreeLocator.first().check({ force: true });
            termsChecked = true;
            logger.info('Terms checkbox checked via Playwright locator');
          }
        } catch (e) {
          logger.warn(`Playwright locator approach failed: ${e.message}`);
        }
      }
    } else {
      logger.warn('Could not find Terms and Conditions checkbox');
    }

    await this.page.waitForTimeout(2000);
    await this.screenshot('checkout-terms');

    const visibleButtons = await this.page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input[type="submit"], a.btn, a.button');
      return [...buttons].filter(b => b.offsetParent !== null).map(b => {
        const clone = b.cloneNode(true);
        clone.querySelectorAll('svg, [aria-hidden="true"], [class*="Icon"]').forEach(n => n.remove());
        return { text: clone.textContent.trim(), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' };
      }).filter(b => b.text.length > 0 && b.text.length < 100);
    });
    logger.info(`Visible buttons on checkout page: ${JSON.stringify(visibleButtons)}`);

    const urlBeforePurchase = this.page.url();

    const purchaseResult = await this.page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input[type="submit"], a.btn, a.button');
      const purchaseTexts = [
        'COMPLETE YOUR PURCHASE',
        'COMPLETE PURCHASE',
        'COMPLETE BOOKING',
        'PLACE ORDER',
        'CONFIRM PURCHASE',
        'CONFIRM RESERVATION',
        'COMPLETE RESERVATION',
        'SUBMIT',
        'RESERVE',
      ];
      for (const btn of buttons) {
        if (btn.offsetParent === null) continue;
        const clone = btn.cloneNode(true);
        clone.querySelectorAll('svg, [aria-hidden="true"], [class*="Icon"]').forEach(n => n.remove());
        const text = clone.textContent.trim().toUpperCase();
        for (const target of purchaseTexts) {
          if (text.includes(target)) {
            const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
            if (!isDisabled) {
              btn.click();
              return { text: clone.textContent.trim(), disabled: false };
            } else {
              return { text: clone.textContent.trim(), disabled: true };
            }
          }
        }
      }
      return null;
    });

    if (purchaseResult && !purchaseResult.disabled) {
      logger.info(`Clicked purchase button: "${purchaseResult.text}"`);

      let purchaseSucceeded = false;
      let confirmationUrl = null;

      for (let wait = 0; wait < 7; wait++) {
        await this.page.waitForTimeout(3000);
        const currentUrl = this.page.url();
        if (currentUrl.includes('/confirmation')) {
          logger.info(`Redirected to confirmation page: ${currentUrl}`);
          confirmationUrl = currentUrl;
          purchaseSucceeded = true;
          break;
        }
        if (currentUrl !== urlBeforePurchase) {
          logger.info(`Page navigated to: ${currentUrl}`);

          const hasConfirmation = await this.page.evaluate(() => {
            const text = document.body.innerText;
            return /reservation\s*#/i.test(text) || /confirmation/i.test(text);
          });
          if (hasConfirmation) {
            purchaseSucceeded = true;
            break;
          }
        }
      }

      if (!purchaseSucceeded) {
        logger.warn('Purchase button was clicked but page did NOT redirect to /confirmation — checkout FAILED');
        logger.warn('This usually means the Terms checkbox was not properly checked');
        await this.screenshot('checkout-no-redirect');
        return { success: false, error: 'Checkout did not redirect to confirmation page (terms may not be checked)', screenshotPath: null };
      }

      await this.page.waitForTimeout(2000);
      const screenshotPath = await this.screenshot('checkout-confirmation');

      const confirmation = await this._extractConfirmation();
      logger.info(`Reservation confirmed! Number: ${confirmation || 'unknown'}`);

      return {
        success: true,
        confirmationNumber: confirmation,
        screenshotPath,
      };
    } else if (purchaseResult && purchaseResult.disabled) {
      logger.warn(`Purchase button "${purchaseResult.text}" is DISABLED — terms checkbox likely not checked`);
      await this.screenshot('checkout-button-disabled');
      return { success: false, error: 'Purchase button is disabled (terms not agreed)', screenshotPath: null };
    } else {
      logger.warn('Could not find "COMPLETE YOUR PURCHASE" button');
      await this.screenshot('checkout-no-purchase-btn');
      return { success: false, error: 'Purchase button not found', screenshotPath: null };
    }
  }

  async getExistingReservations(date) {
    logger.info(`Checking existing reservations for ${date}...`);

    const baseUrl = config.site.memberUrl;
    let foundPage = false;

    const navLabels = ['Reservations', 'My Tee Times', 'My Bookings', 'Upcoming', 'My Reservations'];
    for (const label of navLabels) {
      try {
        const link = await this.page.$(`a:has-text("${label}"), button:has-text("${label}")`);
        if (link && await link.isVisible()) {
          await link.click();
          await this.page.waitForTimeout(3000);

          const pageText = await this.page.evaluate(() => document.body.innerText.slice(0, 2000));
          if (/page not found|404|not found/i.test(pageText)) {
            logger.warn(`"${label}" nav link led to a 404 page — trying next`);
            continue;
          }
          logger.info(`Clicked nav link: "${label}" → ${this.page.url()}`);
          foundPage = true;
          break;
        }
      } catch {

      }
    }

    if (!foundPage) {

      const userMenuSelectors = [
        '[class*="user"] button', '[class*="User"] button',
        'header button:has-text("Visanu")', 'header a:has-text("Visanu")',
        '[class*="account" i]', '[aria-label*="account" i]',
        'header svg[data-testid="PersonIcon"]',
      ];
      for (const sel of userMenuSelectors) {
        try {
          const el = await this.page.$(sel);
          if (el && await el.isVisible()) {
            await el.evaluate(e => e.click());
            await this.page.waitForTimeout(1500);
            logger.info(`Opened user menu via: ${sel}`);
            break;
          }
        } catch {                }
      }

      try {
        const userNameEl = await this.page.evaluate(() => {
          const els = document.querySelectorAll('header span, header a, header button, header p');
          for (const el of els) {
            if (el.textContent.trim().length > 3 && el.textContent.trim().length < 40 &&
                !['Tee Times', 'Course Info', 'Reservations'].includes(el.textContent.trim())) {
              const rect = el.getBoundingClientRect();
              if (rect.left > window.innerWidth * 0.5 && rect.top < 50) {
                el.click();
                return el.textContent.trim();
              }
            }
          }
          return null;
        });
        if (userNameEl) {
          logger.info(`Clicked user name: "${userNameEl}"`);
          await this.page.waitForTimeout(1500);
        }
      } catch {              }

      const menuLabels = ['Dashboard', 'Tee Time Alerts', 'Account', 'My Reservations', 'My Bookings'];
      for (const label of menuLabels) {
        try {
          const item = await this.page.$(`a:has-text("${label}"), button:has-text("${label}"), [role="menuitem"]:has-text("${label}")`);
          if (item && await item.isVisible()) {
            await item.click();
            await this.page.waitForTimeout(3000);
            const pageText = await this.page.evaluate(() => document.body.innerText.slice(0, 2000));
            if (/page not found|404/i.test(pageText)) {
              logger.warn(`"${label}" menu item led to a 404 — trying next`);
              continue;
            }

            if (this.page.url().includes('/checkout')) {
              logger.warn(`"${label}" menu item stayed on /checkout — trying next`);
              continue;
            }
            logger.info(`Clicked user menu item: "${label}" → ${this.page.url()}`);
            foundPage = true;
            break;
          }
        } catch {

        }
      }
    }

    if (!foundPage) {
      const urlPatterns = [
        `${baseUrl}/my-tee-times`,
        `${baseUrl}/my-bookings`,
        `${baseUrl}/upcoming`,
      ];

      for (const url of urlPatterns) {
        try {
          const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (response && response.status() < 400) {
            await this.page.waitForTimeout(3000);
            const pageText = await this.page.evaluate(() => document.body.innerText.slice(0, 2000));
            if (/page not found|404/i.test(pageText)) continue;
            if (/reservat|my tee|my book|upcoming|booked/i.test(pageText)) {
              logger.info(`Found reservations page at: ${url}`);
              foundPage = true;
              break;
            }
          }
        } catch {

        }
      }
    }

    if (!foundPage) {
      logger.warn('Could not find reservations page — skipping reservation check');
      return [];
    }

    await this.screenshot('reservations-page');

    try {
      await this.page.evaluate(() => {

        const selects = document.querySelectorAll('select');
        for (const sel of selects) {
          for (const opt of sel.options) {
            if (opt.value === '50' || opt.text === '50') {
              sel.value = '50';
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      });
      await this.page.waitForTimeout(1500);
    } catch {                                   }

    const [resYear, resMonth, resDay] = date.split('-').map(Number);
    const _monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
    const _shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const datePatterns = [
      date,
      `${resMonth}/${resDay}/${resYear}`,
      `${String(resMonth).padStart(2,'0')}/${String(resDay).padStart(2,'0')}/${resYear}`,
      `${_monthNames[resMonth-1]} ${resDay}`,
      `${_shortMonths[resMonth-1]} ${resDay}`,
      `${_monthNames[resMonth-1]} ${String(resDay).padStart(2,'0')}`,
      `${_shortMonths[resMonth-1]} ${String(resDay).padStart(2,'0')}`,
    ];

    const extractFromCurrentPage = async () => {
      return await this.page.evaluate(({ targetDate, patterns }) => {
        const results = [];
        const seen = new Set();

        function extractFromText(text) {
          if (!patterns.some(p => text.includes(p))) return;
          const timeMatch = text.match(/(\d{1,2}:\d{2})\s*(AM|PM|am|pm)/i);
          if (!timeMatch) return;
          let [, t, period] = timeMatch;
          let [h, m] = t.split(':').map(Number);
          if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
          if (period.toUpperCase() === 'AM' && h === 12) h = 0;
          const time24 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          const key = `${time24}-${text.slice(0, 30)}`;
          if (seen.has(key)) return;
          seen.add(key);
          let course = 'Unknown';
          if (/pines/i.test(text)) course = 'Pines';
          else if (/oaks/i.test(text)) course = 'Oaks';
          const playerMatch = text.match(/(\d)\s*(?:player|golfer)/i);
          const players = playerMatch ? parseInt(playerMatch[1]) : 4;

          const resMatch = text.match(/(?:Confirmation|Reservation)\s*#\s*(?:[^|\n]+\|)?(\d+)/i);
          const reservationNumber = resMatch ? resMatch[1] : null;
          results.push({ time: time24, course, players, date: targetDate, reservationNumber });
        }

        const selectors = [
          '[role="dialog"]', '[class*="modal" i]',
          '[class*="card" i]', '[class*="reservation" i]', '[class*="booking" i]',
          '[class*="tee-time" i]', '[class*="teeTime" i]',
          'tr', 'li', '[role="listitem"]', '[class*="Card"]',
        ];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            const text = el.textContent || '';
            if (text.length < 10 || text.length > 6000) continue;
            extractFromText(text);
          }
        }

        if (results.length === 0) {
          const bodyText = document.body.innerText || '';
          if (patterns.some(p => bodyText.includes(p))) {
            extractFromText(bodyText);
          }
        }

        const deduped = new Set();
        return results.filter(r => {
          const k = `${r.time}-${r.course}`;
          if (deduped.has(k)) return false;
          deduped.add(k);
          return true;
        });
      }, { targetDate: date, patterns: datePatterns });
    };

    try {
      await this.page.waitForFunction(
        () => /VIEW DETAILS|View Details/i.test(document.body.innerText || ''),
        { timeout: 12000, polling: 300 }
      );
    } catch {                                                       }
    await this.page.waitForTimeout(300);

    const MAX_PAGES = 20;
    const reservations = [];
    let lastPageHadDate = false;

    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {

      const dateOnPage = await this.page.evaluate(
        (patterns) => patterns.some(p => (document.body.innerText || '').includes(p)),
        datePatterns
      );

      if (dateOnPage) {
        lastPageHadDate = true;
        logger.info(`Page ${pageNum + 1}: found date ${date} — processing matching cards`);

        let processed = 0;
        while (true) {
          const clicked = await this.page.evaluate(({ patterns, skip }) => {
            const cards = [...document.querySelectorAll('[class*="Card"], [class*="card"], li, [role="listitem"]')];
            const matching = cards.filter(c => {
              const t = c.textContent || '';
              return t.length > 10 && t.length < 3000 && patterns.some(p => t.includes(p));
            });
            if (matching.length <= skip) return false;
            const btn = [...matching[skip].querySelectorAll('button')].find(
              b => /view details/i.test(b.textContent || '')
            );
            if (btn) { btn.click(); return true; }
            return false;
          }, { patterns: datePatterns, skip: processed }).catch(() => false);

          if (!clicked) break;
          await this.page.waitForTimeout(2000);

          const onDetailPage = await this.page.evaluate(
            () => /CANCEL OR MODIFY|Reservation Details/i.test(document.body.innerText || '')
          );
          if (onDetailPage) {
            await this.page.waitForTimeout(500);
          }

          const found = await extractFromCurrentPage();
          for (const r of found) {
            if (!reservations.some(e => e.time === r.time && e.course === r.course)) {
              reservations.push(r);
            }
          }
          processed++;

          if (onDetailPage) {
            logger.debug(`Card ${processed}: extracted ${found.length} reservation(s) — going back`);
            await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(async () => {
              await this.page.evaluate(() => window.history.back());
            });
            await this.page.waitForTimeout(1500);
            try {
              await this.page.waitForFunction(
                () => /VIEW DETAILS/i.test(document.body.innerText || ''),
                { timeout: 8000, polling: 300 }
              );
            } catch {                         }
          }
        }
      } else if (lastPageHadDate) {

        break;
      }

      const advanced = await this._tryAdvanceReservationsPage();
      if (!advanced) {
        logger.debug(`No more reservation pages after page ${pageNum + 1}`);
        break;
      }
      logger.info(`Advancing to reservation page ${pageNum + 2}...`);

      try {
        await this.page.waitForFunction(
          () => /VIEW DETAILS|View Details/i.test(document.body.innerText || ''),
          { timeout: 8000, polling: 300 }
        );
      } catch {                       }
      await this.page.waitForTimeout(300);
    }

    if (reservations.length > 0) {
      const details = reservations.map(r => `${r.time} (${r.course})${r.reservationNumber ? ' Res#' + r.reservationNumber : ''}`).join(', ');
      logger.info(`Found ${reservations.length} existing reservations for ${date}: ${details}`);
    } else {
      logger.info(`No existing reservations found for ${date}`);
    }

    return reservations;
  }

  async verifyBookingOnSite(date, time) {
    logger.info(`Verifying booking on Reservations page: ${date} ${time}...`);

    try {
      const reservations = await this.getExistingReservations(date);

      if (reservations.length === 0) {
        logger.warn(`Verification: no reservations found for ${date}`);
        await this.screenshot('verify-no-reservations');
        return { verified: false, reservations };
      }

      const bookedMinutes = this._timeToMinutes(time);
      const match = reservations.find(r => {
        const resMinutes = this._timeToMinutes(r.time);
        return Math.abs(resMinutes - bookedMinutes) <= 15;
      });

      if (match) {
        logger.info(`Verification SUCCESS: found reservation at ${match.time} (${match.course}) matching booked time ${time}`);
        return { verified: true, reservations };
      }

      logger.warn(`Verification FAILED: no reservation near ${time} found on ${date}. Found: ${reservations.map(r => r.time).join(', ')}`);
      await this.screenshot('verify-mismatch');
      return { verified: false, reservations };
    } catch (error) {
      logger.warn(`Verification error: ${error.message}`);
      return { verified: false, reservations: [] };
    }
  }

  async _tryAdvanceReservationsPage() {
    const nextSelectors = [
      'button:has-text("NEXT")',
      'button:has-text("Next")',
      'a:has-text("NEXT")',
      'a:has-text("Next")',
      'button:has-text("Load More")',
      'button:has-text("Show More")',
      'button:has-text("View More")',
      '[aria-label="Next page"]',
      '[aria-label="next"]',
      '[aria-label="Go to next page"]',
      'li[class*="next"] a',
      '[class*="pagination"] [class*="next"]:not([class*="disabled"])',
    ];

    for (const sel of nextSelectors) {
      try {
        const btn = await this.page.$(sel);
        if (!btn || !(await btn.isVisible())) continue;
        const disabled = await btn.evaluate(el =>
          el.disabled ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.classList.contains('disabled') ||
          el.closest('[class*="disabled"]') !== null
        );
        if (disabled) continue;
        await btn.evaluate(el => el.click());
        await this.page.waitForTimeout(2000);
        logger.debug(`Advanced reservations page via: ${sel}`);
        return true;
      } catch {                         }
    }

    const prevHeight = await this.page.evaluate(() => document.body.scrollHeight);
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(1500);
    const newHeight = await this.page.evaluate(() => document.body.scrollHeight);
    if (newHeight > prevHeight) {
      logger.debug('Scrolled down to trigger infinite-scroll reservation load');
      return true;
    }

    return false;
  }

  _timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  async _handleCheckout(slotIndex) {
    logger.info('Handling checkout flow...');

    const checkoutSelectors = [
      'button:has-text("Checkout")',
      'button:has-text("Complete")',
      'button:has-text("Confirm Booking")',
      'button:has-text("Finish")',
      'button:has-text("Place Order")',
      'button:has-text("Submit")',
    ];

    for (const sel of checkoutSelectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click();
          await this.page.waitForTimeout(3000);
          logger.info(`Checkout submitted via: ${sel}`);

          const confirmation = await this._extractConfirmation();
          const screenshotPath = await this.screenshot(`slot-${slotIndex}-checkout`);

          return {
            success: !!confirmation,
            confirmationNumber: confirmation,
            screenshotPath,
            error: confirmation ? null : 'Checkout completed but no confirmation found',
          };
        }
      } catch {

      }
    }

    const screenshotPath = await this.screenshot(`slot-${slotIndex}-no-checkout`);
    return { success: false, error: 'No checkout button found', screenshotPath };
  }

  async navigateToReservationHistory() {
    const url = `${config.site.memberUrl}/reservation/history`;
    logger.info(`Navigating to reservation history: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForTimeout(3000);

    const pageUrl = this.page.url();
    const pageText = await this.page.evaluate(() => document.body.innerText.slice(0, 2000));

    if (/page not found|404/i.test(pageText)) {
      logger.warn(`Reservation history page returned 404, trying alternate URLs...`);
      const alternates = [
        `${config.site.memberUrl}/reservations`,
        `${config.site.memberUrl}/my-tee-times`,
        `${config.site.memberUrl}/reservation`,
      ];
      for (const alt of alternates) {
        try {
          await this.page.goto(alt, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await this.page.waitForTimeout(3000);
          const text = await this.page.evaluate(() => document.body.innerText.slice(0, 2000));
          if (!/page not found|404/i.test(text)) {
            logger.info(`Found reservation page at: ${alt}`);
            return true;
          }
        } catch {                }
      }
      throw new Error('Could not find reservation history page');
    }

    logger.info(`On reservation history page: ${pageUrl}`);

    try {
      await this.page.waitForFunction(() => {

        const spinners = document.querySelectorAll('[class*="CircularProgress"], [class*="spinner"], [role="progressbar"]');
        const visibleSpinner = Array.from(spinners).some(s => s.offsetParent !== null);
        return !visibleSpinner;
      }, { timeout: 15000 });
      logger.info('Reservation page finished loading');
    } catch {
      logger.warn('Timed out waiting for reservation page to finish loading — proceeding anyway');
    }
    await this.page.waitForTimeout(2000);

    try {

      let pageLengthChanged = false;

      try {

        const selectEl = await this.page.$('select');
        if (selectEl) {
          const options = await selectEl.evaluate(sel => Array.from(sel.options).map(o => ({ value: o.value, text: o.text })));
          logger.info(`Found native select with options: ${options.map(o => o.text).join(', ')}`);

          const sorted = options.filter(o => !isNaN(parseInt(o.value))).sort((a, b) => parseInt(b.value) - parseInt(a.value));
          if (sorted.length > 0) {
            await selectEl.selectOption(sorted[0].value);
            logger.info(`Set page length to: ${sorted[0].text}`);
            pageLengthChanged = true;
          }
        }
      } catch (e) {
        logger.debug(`Native select approach failed: ${e.message}`);
      }

      if (!pageLengthChanged) {
        try {
          const clicked = await this.page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent.trim();
              if (text.length > 50) continue;
              if (/^page\s*length$/i.test(text)) {

                const parent = el.parentElement;
                if (!parent) continue;

                for (const child of parent.querySelectorAll('*')) {
                  const ct = child.textContent.trim();
                  if (/^\d+$/.test(ct) && parseInt(ct) <= 50) {
                    child.click();
                    return 'clicked-number';
                  }
                  if (child.getAttribute('role') === 'button' || child.classList.toString().includes('Select')) {
                    child.click();
                    return 'clicked-mui';
                  }
                }
              }
            }
            return null;
          });
          if (clicked) {
            logger.info(`Opened page length dropdown via: ${clicked}`);
            await this.page.waitForTimeout(1000);

            const selected = await this.page.evaluate(() => {
              const items = document.querySelectorAll('[role="option"], [role="listbox"] li, ul[role="listbox"] li, [class*="MuiMenuItem"]');
              if (items.length === 0) return null;
              let best = null, bestVal = 0;
              for (const item of items) {
                const n = parseInt(item.textContent.trim());
                if (!isNaN(n) && n > bestVal) { bestVal = n; best = item; }
              }
              if (best) { best.click(); return bestVal; }
              return null;
            });
            if (selected) {
              logger.info(`Set page length to: ${selected}`);
              pageLengthChanged = true;
            }
          }
        } catch (e) {
          logger.debug(`MUI click approach failed: ${e.message}`);
        }
      }

      if (!pageLengthChanged) {
        logger.info('Could not increase page length — will paginate with NEXT button');
      } else {
        await this.page.waitForTimeout(3000);
      }
    } catch {
      logger.debug('Could not change page length');
    }

    await this.screenshot('reservation-history');
    return true;
  }

  async cancelReservations(bookings) {
    const results = { cancelled: 0, failed: 0, details: [] };

    for (let i = 0; i < bookings.length; i++) {
      const booking = bookings[i];
      const resNum = booking.confirmation_number;
      const time = booking.actual_time || booking.target_time;
      const label = `${time} ${booking.course} (Res#${resNum})`;

      logger.info(`Cancelling ${i + 1}/${bookings.length}: ${label}...`);

      try {

        const cancelUrl = `${config.site.memberUrl}/reservation/history/${resNum}/cancel`;
        logger.info(`Navigating to: ${cancelUrl}`);
        await this.page.goto(cancelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        await this.page.waitForTimeout(5000);
        await this.screenshot(`cancel-page-${i}`);

        const cancelPagePattern = /cancell?ation\s*request|cancel\s+(reservation|booking|tee\s+time)/i;
        let pageText = await this.page.evaluate(() => document.body.innerText.slice(0, 3000));
        if (!cancelPagePattern.test(pageText)) {

          await this.page.waitForTimeout(4000);
          pageText = await this.page.evaluate(() => document.body.innerText.slice(0, 3000));
          if (!cancelPagePattern.test(pageText)) {
            logger.warn(`Cancel page did not load for ${label}. Text: ${pageText.slice(0, 300)}`);
            results.failed++;
            results.details.push({ resNum, time, course: booking.course, success: false, error: 'Cancel page did not load' });
            continue;
          }
          logger.info(`Cancel page loaded after extra wait for ${label}`);
        }

        const playersSelected = await this._selectMuiDropdown(0, 'last');
        if (!playersSelected) {
          logger.warn('Could not select number of players to cancel');
          results.failed++;
          results.details.push({ resNum, time, course: booking.course, success: false, error: 'Could not select players' });
          continue;
        }
        logger.info(`Selected players to cancel: "${playersSelected}"`);
        await this.page.waitForTimeout(500);

        const reasonSelected = await this._selectMuiDropdown(1, 'first');
        if (!reasonSelected) {
          logger.warn('Could not select cancellation reason');
          results.failed++;
          results.details.push({ resNum, time, course: booking.course, success: false, error: 'Could not select reason' });
          continue;
        }
        logger.info(`Selected cancellation reason: "${reasonSelected}"`);
        await this.page.waitForTimeout(500);

        await this.screenshot(`cancel-form-filled-${i}`);

        const submitted = await this.page.evaluate(() => {
          const buttons = document.querySelectorAll('button, [role="button"]');
          for (const btn of buttons) {
            if (btn.offsetParent === null) continue;
            if (/submit.*cancel/i.test(btn.textContent.trim())) {
              btn.click();
              return btn.textContent.trim();
            }
          }
          return null;
        });

        if (!submitted) {
          logger.warn('Could not find SUBMIT CANCELLATION button');
          results.failed++;
          results.details.push({ resNum, time, course: booking.course, success: false, error: 'Submit button not found' });
          continue;
        }
        logger.info(`Clicked: "${submitted}"`);

        await this.page.waitForTimeout(5000);
        await this.screenshot(`cancel-result-${i}`);

        const resultText = await this.page.evaluate(() => document.body.innerText.slice(0, 3000));
        const hasError = /error|failed|could not cancel|unable/i.test(resultText) && !/cancel.*success/i.test(resultText);

        if (hasError) {
          logger.warn(`Cancellation may have failed for ${label}`);
          results.failed++;
          results.details.push({ resNum, time, course: booking.course, success: false, error: 'Page showed error' });
        } else {
          logger.info(`Cancellation submitted for ${label}`);
          results.cancelled++;
          results.details.push({ resNum, time, course: booking.course, success: true });
        }
      } catch (error) {
        logger.error(`Error cancelling ${label}: ${error.message}`);
        await this.screenshot(`cancel-error-${i}`);
        results.failed++;
        results.details.push({ resNum, time, course: booking.course, success: false, error: error.message });
      }
    }

    return results;
  }

  async _selectMuiDropdown(dropdownIndex, pickStrategy) {

    const selectLocator = this.page.locator('div.MuiSelect-select');
    const count = await selectLocator.count();

    if (count <= dropdownIndex) {
      logger.warn(`Only ${count} MUI Select(s) found, need index ${dropdownIndex}`);
      return null;
    }

    await selectLocator.nth(dropdownIndex).click();
    await this.page.waitForTimeout(1000);

    const optionLocator = this.page.locator('[role="option"], li.MuiMenuItem-root');
    const optionTexts = await optionLocator.allTextContents();

    if (optionTexts.length === 0) {
      logger.warn(`No options found in dropdown ${dropdownIndex}`);
      return null;
    }

    const targetIdx = pickStrategy === 'last' ? optionTexts.length - 1 : 0;
    await optionLocator.nth(targetIdx).click();
    await this.page.waitForTimeout(500);

    return optionTexts[targetIdx];
  }

  async _extractDetailPage(fallbackId) {
    return this.page.evaluate((fb) => {
      const body = document.body.innerText || '';
      const urlMatch = window.location.href.match(/\/reservation\/history\/(\d+)/);
      const confirmationNumber = urlMatch ? urlMatch[1] : fb;

      const timeMatch = body.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
      let time24 = null;
      if (timeMatch) {
        let [, t, period] = timeMatch;
        let [h, m] = t.split(':').map(Number);
        if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
        if (period.toUpperCase() === 'AM' && h === 12) h = 0;
        time24 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }

      const dateMatch = body.match(
        /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\w+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i
      );
      let dateStr = null;
      if (dateMatch) {
        const months = { January:1, February:2, March:3, April:4, May:5, June:6,
                         July:7, August:8, September:9, October:10, November:11, December:12 };
        const month = months[dateMatch[1]];
        const day = parseInt(dateMatch[2]);
        const year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();
        if (month) dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      }

      let course = 'Unknown';
      if (/pines/i.test(body)) course = 'Pines';
      else if (/oaks/i.test(body)) course = 'Oaks';

      let players = null;
      const playerPatterns = [
        /\bGOLFERS\s+(\d+)\b/,
        /(\d+)\s*(?:player|golfer|person|spot)s?\b/i,
        /\b(\d+)\s*x\s*(?:player|golfer)/i,
        /qty[:\s]+(\d+)/i,
        /quantity[:\s]+(\d+)/i,
      ];
      for (const re of playerPatterns) {
        const m = body.match(re);
        if (m) { players = parseInt(m[1], 10); break; }
      }

      return { date: dateStr, time: time24, course, confirmationNumber, players };
    }, fallbackId);
  }

  async scrapeReservationHistory() {
    if (!this.page) {
      throw new Error('scrapeReservationHistory() called before init() — this.page is not initialised');
    }

    const baseUrl = config.site.memberUrl;
    const reservations = [];

    logger.info('Navigating to reservation history...');
    await this.page.goto(`${baseUrl}/reservation/history`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(3000);

    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(1500);
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(1000);

    try {
      await this.page.waitForFunction(
        () => /VIEW DETAILS|View Details/i.test(document.body.innerText || ''),
        { timeout: 10000, polling: 300 }
      );
    } catch {                }

    const cardCount = await this.page.evaluate(() =>
      [...document.querySelectorAll('button')].filter(b => /view details/i.test(b.textContent || '')).length
    ).catch(() => 0);

    logger.info(`Found ${cardCount} card(s) on reservation list page`);

    for (let idx = 0; idx < cardCount; idx++) {
      const clicked = await this.page.evaluate((skip) => {
        const btns = [...document.querySelectorAll('button')].filter(
          b => /view details/i.test(b.textContent || '')
        );
        if (btns.length <= skip) return false;
        btns[skip].click();
        return true;
      }, idx).catch(() => false);

      if (!clicked) break;
      await this.page.waitForTimeout(2000);

      const res = await this._extractDetailPage(null);
      if (res.date && res.time) {
        logger.info(`  Card ${idx + 1}: ${res.date} ${res.time} ${res.course} Res#${res.confirmationNumber}`);
        reservations.push(res);
      } else {
        logger.warn(`  Card ${idx + 1}: could not extract (url=${this.page.url()})`);
      }

      await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(async () => {
        await this.page.goto(`${baseUrl}/reservation/history`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      });
      await this.page.waitForTimeout(1500);
      try {
        await this.page.waitForFunction(
          () => /VIEW DETAILS/i.test(document.body.innerText || ''),
          { timeout: 8000, polling: 300 }
        );
      } catch {          }
    }

    return reservations;
  }

  async fetchReservationById(id) {
    if (!this.page) {
      throw new Error('fetchReservationById() called before init() — this.page is not initialised');
    }

    const baseUrl = config.site.memberUrl;
    const url = `${baseUrl}/reservation/history/${id}/details`;
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.page.waitForTimeout(1500);

      const bodyText = await this.page.evaluate(() => document.body.innerText || '');
      if (/page not found|404|not found/i.test(bodyText.slice(0, 500))) return null;
      if (!bodyText.includes(':')) return null;

      const res = await this._extractDetailPage(String(id));
      return (res.date && res.time) ? res : null;
    } catch {
      return null;
    }
  }
}

module.exports = SiteAutomation;
