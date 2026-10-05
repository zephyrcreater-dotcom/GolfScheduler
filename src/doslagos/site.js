const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { browserStartupError } = require('./browser-error');
const { verifyConfirmation } = require('./confirmation');
const { parseHistoryCards } = require('./history');

let _screenshotDirEnsured = false;

class DosLagosSite {
  constructor({ email, password } = {}) {
    this.email = email || config.email;
    this.password = password || config.password;

    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init() {
    try {
      this.browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true',
        executablePath: config.chromiumExecutablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: config.timezone,
      });

      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(30000);
    } catch (cause) {
      await this.close().catch(() => {});
      throw browserStartupError(cause);
    }
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
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      _screenshotDirEnsured = true;
    }

    const filePath = path.join(
      dir,
      `${name}-${Date.now()}.png`
    );

    await this.page.screenshot({
      path: filePath,
      fullPage: true,
    });

    return filePath;
  }

  async _dismissModals() {
    try {
      const backdrop = await this.page.$('.MuiBackdrop-root');

      if (backdrop) {
        await backdrop.click({ force: true });
        await this.page.waitForTimeout(500);
      }

      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
    } catch {
      // ignore
    }
  }

  async _checkForBlocks() {
    const blockSelectors = [
      '.g-recaptcha',
      '#captcha',
      'iframe[src*="recaptcha"]',
      'iframe[src*="captcha"]',
      'text=Access Denied',
      'text=Rate Limited',
    ];

    for (const sel of blockSelectors) {
      try {
        const el = await this.page.$(sel);

        if (el && await el.isVisible()) {
          const screenshotPath = await this.screenshot('blocked');

          const err = new Error(
            `BLOCKED: security challenge detected (${sel})`
          );

          err.screenshotPath = screenshotPath;
          err.blocked = true;

          throw err;
        }
      } catch (e) {
        if (e.blocked) {
          throw e;
        }
      }
    }
  }

  /*
   * Login to the TeeItUp site.
   */
  async login() {
    await this.page.goto(config.site.baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await this.page.waitForTimeout(2000);

    const loginSelectors = [
      'button:has-text("Login")',
      'button:has-text("Sign Up")',
      'a:has-text("Login")',
      'button:has-text("Log In")',
    ];

    let clicked = false;

    for (const sel of loginSelectors) {
      const el = await this.page.$(sel);

      if (el && await el.isVisible()) {
        await el.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      throw new Error(
        'Could not find Login link on Dos Lagos site'
      );
    }

    await this.page
      .waitForURL(/\/login/, { timeout: 15000 })
      .catch(() => {});

    await this.page.waitForTimeout(1000);

    await this._checkForBlocks();

    const emailField = await this.page.waitForSelector(
      'input[type="email"], input[name="email"], input[name="username"]',
      { timeout: 10000 }
    );

    await emailField.fill(this.email);

    const passwordField = await this.page.$(
      'input[type="password"], input[name="password"]'
    );

    if (!passwordField) {
      throw new Error(
        'Could not find password field on login form'
      );
    }

    await passwordField.fill(this.password);

    const submitBtn = await this.page.$(
      'button[type="submit"]'
    );

    if (submitBtn) {
      await submitBtn.click();
    } else {
      await passwordField.press('Enter');
    }

    await this.page
      .waitForURL(
        url => !url.pathname.includes('/login'),
        { timeout: 20000 }
      )
      .catch(() => {});

    await this.page.waitForTimeout(3000);

    await this._checkForBlocks();

    const bodyText = await this.page.evaluate(
      () => document.body.innerText
    );

    if (
      /could not authenticate|incorrect password|invalid credentials/i
        .test(bodyText)
    ) {
      const screenshotPath =
        await this.screenshot('login-error');

      throw new Error(
        `Login rejected by site. Screenshot: ${screenshotPath}`
      );
    }

    if (/Login\s*\/\s*Sign\s*Up/i.test(bodyText)) {
      const screenshotPath =
        await this.screenshot('login-not-confirmed');

      throw new Error(
        `Login did not complete — "Login / Sign Up" still showing in header. Screenshot: ${screenshotPath}`
      );
    }
  }

  /*
   * Navigate directly to a date's tee times.
   */
  async searchDate(dateStr) {
    const url =
      `${config.site.baseUrl}/teetimes` +
      `?course=${config.site.courseId}` +
      `&date=${dateStr}`;

    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await this.page.waitForTimeout(3000);

    await this._dismissModals();
  }

  /*
   * Return all currently available tee times.
   */
  async getAvailableTimes() {
    const cards = await this.page.evaluate(() => {
      const buttons = Array
        .from(document.querySelectorAll('button'))
        .filter(b => /book now/i.test(b.textContent));

      return buttons.map((btn, i) => {
        let node = btn;
        let cardText = '';

        for (
          let d = 0;
          d < 5 && node;
          d++, node = node.parentElement
        ) {
          const t = node.textContent || '';

          if (
            /\d{1,2}:\d{2}\s*(AM|PM)/i.test(t) &&
            t.length < 400
          ) {
            cardText = t;
            break;
          }
        }

        return {
          index: i,
          text: cardText,
        };
      });
    });

    const times = [];

    for (const c of cards) {
      const m = c.text.match(
        /(\d{1,2}):(\d{2})\s*(AM|PM)/i
      );

      if (!m) {
        continue;
      }

      let [, h, min, period] = m;

      h = parseInt(h, 10);

      if (/pm/i.test(period) && h !== 12) {
        h += 12;
      }

      if (/am/i.test(period) && h === 12) {
        h = 0;
      }

      const time24 =
        `${String(h).padStart(2, '0')}:${min}`;

      const priceMatch = c.text.match(
        /\$(\d+(?:\.\d{2})?)/
      );
      const capacityMatch = c.text.match(/([1-4])\s*[-–]\s*([1-4])\s*(?:players|golfers)/i);

      times.push({
        time: time24,
        label: m[0],
        price: priceMatch ? priceMatch[1] : null,
        index: c.index,
        maxGolfers: capacityMatch ? Number(capacityMatch[2]) : null,
      });
    }

    times.sort(
      (a, b) => a.time.localeCompare(b.time)
    );

    return times;
  }

  /*
   * Fill sandbox payment information.
   *
   * This fills the form but DOES NOT click the final
   * purchase / reservation confirmation button.
   */
  async fillPaymentForm(card = config.card) {

    if (!card) {
      throw new Error(
        'config.card is not configured'
      );
    }

    /*
     * Try multiple selectors because the exact field names
     * may vary between checkout implementations.
     */
    const fillIfPresent = async (
      selectors,
      value
    ) => {
      if (!value) {
        return false;
      }

      for (const selector of selectors) {
        const field =
          this.page.locator(selector).first();

        if (await field.count()) {
          try {
            await field.waitFor({
              state: 'visible',
              timeout: 3000,
            });

            await field.fill(String(value));

            return true;
          } catch {
            // Try next selector
          }
        }
      }

      return false;
    };

    // MUI Select controls are divs, not inputs. Open their listbox and
    // select an option by its value or visible label.
    const selectOption = async (selector, value, kind) => {
      if (!value) return false;
      const control = this.page.locator(selector);
      await control.click();
      const options = this.page.getByRole('listbox').getByRole('option');
      await options.first().waitFor({ state: 'visible' });
      const normalize = text => String(text).trim().toLowerCase();
      const desired = normalize(value);
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'];
      for (let i = 0; i < await options.count(); i++) {
        const option = options.nth(i);
        const label = normalize(await option.innerText());
        const optionValue = normalize(await option.getAttribute('data-value') || '');
        let matches = label === desired || optionValue === desired;
        if (kind === 'month' && /^\d{1,2}$/.test(desired)) {
          const month = Number(desired);
          const labelNumber = label.match(/^\d{1,2}\b/);
          matches ||= (optionValue !== '' && Number(optionValue) === month) ||
            (labelNumber && Number(labelNumber[0]) === month) ||
            (month >= 1 && month <= 12 && label.includes(monthNames[month - 1]));
        }
        if (kind === 'year' && /^\d{2}$/.test(desired)) {
          matches ||= label === `20${desired}` || optionValue === `20${desired}`;
        }
        if (matches) {
          await option.click();
          return true;
        }
      }
      await this.page.keyboard.press('Escape');
      throw new Error(`No matching ${kind} option in ${selector}`);
    };

    const result = {};

    /*
     * CARD NUMBER
     */
    result.number = false;
    if (card.number) {
      const digits = String(card.number).replace(/[\s-]/g, '');
      if (!/^\d{12,19}$/.test(digits)) {
        throw new Error('Test card number must contain 12–19 digits');
      }
      const field = this.page.locator('#credit-card-number-input');
      await field.fill('');
      await field.pressSequentially(digits, { delay: 100 });
      await field.blur();
      if ((await field.inputValue()).replace(/\D/g, '') !== digits) {
        throw new Error('Card number entry lost digits; payment filling stopped');
      }
      result.number = true;
    }

    /*
     * CARDHOLDER NAME
     */
    result.name = await fillIfPresent(
      [
        'input[autocomplete="cc-name"]',
        'input[name="cardName"]',
        'input[name*="cardName" i]',
        'input[name*="cardholder" i]',
        'input[id*="cardholder" i]',
      ],
      card.name
    );

    /*
     * EXPIRATION MONTH
     */
    result.expMonth = await selectOption('#cc-exp-month-button', card.expMonth, 'month');

    /*
     * EXPIRATION YEAR
     */
    result.expYear = await selectOption('#cc-exp-year-button', card.expYear, 'year');

    /*
     * SANDBOX CVV
     */
    result.cvv = await fillIfPresent(
      [
        '#cvv-input',
        'input[autocomplete="cc-csc"]',
        'input[name="cvv"]',
        'input[name*="cvv" i]',
        'input[name*="cvc" i]',
        'input[name*="securityCode" i]',
        'input[id*="cvv" i]',
        'input[id*="cvc" i]',
      ],
      card.cvv
    );

    /*
     * BILLING ADDRESS
     */
    result.address = await fillIfPresent(
      [
        '#billing-address-input',
        'input[autocomplete="street-address"]',
        'input[name*="billingAddress" i]',
        'input[name*="address" i]',
      ],
      card.billingAddress
    );

    /*
     * BILLING ZIP
     */
    result.postal = await fillIfPresent(
      [
        '#postal-code-input',
        'input[autocomplete="postal-code"]',
        'input[name*="postal" i]',
        'input[name*="zip" i]',
      ],
      card.billingPostal
    );

    result.country = await selectOption('#cc-address-country-button', card.billingCountry, 'country');

    const requiredCheckbox = this.page.locator('input[type="checkbox"][name="chb-nm"]');
    await requiredCheckbox.check();
    result.requiredCheckbox = await requiredCheckbox.isChecked();

    return result;
  }

  /*
   * Select tee time, choose golfer count, add to cart,
   * and reach checkout. Payment filling and the final purchase click
   * are controlled independently by the caller.
   */
  async reserveAndReachCheckout(
    index,
    golferCount = 1,
    { fillPayment = true, paymentCard = config.card, completePurchase = true,
      expectedSlot, beforePurchase = async () => {} } = {}
  ) {
    try {
      if (expectedSlot) {
        const current = (await this.getAvailableTimes()).find(slot => slot.index === index);
        if (!current || current.time !== expectedSlot.time || current.price !== expectedSlot.price) {
          throw new Error('Selected tee time changed before booking; stopped for review');
        }
      }
      const bookButtons = await this.page.$$(
        'button:has-text("BOOK NOW"), button:has-text("Book Now")'
      );

      const btn = bookButtons[index];

      if (!btn) {
        return {
          reached: false,
          error:
            'tee time button not found (page may have changed)',
        };
      }

      await btn.evaluate(el => {
        el.scrollIntoView({
          block: 'center',
        });

        el.click();
      });

      /*
       * Wait for booking modal.
       */
      try {
        await this.page.waitForSelector(
          '[data-testid="add-to-cart-button"]',
          {
            state: 'visible',
            timeout: 15000,
          }
        );
      } catch {
        const screenshotPath =
          await this.screenshot(
            'add-to-cart-never-appeared'
          );

        return {
          reached: false,
          error:
            'Add to Cart button never appeared',
          screenshotPath,
        };
      }

      /*
       * Wait for golfer-count controls.
       */
      await this.page.waitForFunction(
        () => {
          const boxes = Array
            .from(
              document.querySelectorAll(
                'div.MuiBox-root'
              )
            )
            .filter(
              d =>
                d.children.length === 0 &&
                /^[1-4]$/.test(
                  d.textContent.trim()
                )
            );

          return boxes.length >= 2;
        },
        null,
        {
          timeout: 15000,
        }
      ).catch(() => {});

      await this.page.waitForTimeout(300);

      /*
       * Select requested golfer count.
       */
      const golferResult =
        await this.page.evaluate(
          desired => {
            const boxes = Array
              .from(
                document.querySelectorAll(
                  'div.MuiBox-root'
                )
              )
              .filter(
                d =>
                  d.children.length === 0 &&
                  /^[1-4]$/.test(
                    d.textContent.trim()
                  )
              );

            if (boxes.length === 0) {
              return {
                error:
                  'no golfer-count controls found',
              };
            }

            const match = boxes.find(
              d =>
                d.textContent.trim() ===
                String(desired)
            );

            if (!match) {
              return {
                error:
                  `golfer count ${desired} not offered ` +
                  `(available: ${boxes
                    .map(
                      d =>
                        d.textContent.trim()
                    )
                    .join(',')})`,
              };
            }

            const target =
              match.closest('span') ||
              match;

            const isDisabled =
              target.classList.contains(
                'Mui-disabled'
              ) ||
              target.closest(
                '.Mui-disabled'
              ) !== null ||
              parseFloat(
                getComputedStyle(target)
                  .opacity
              ) < 0.5;

            if (isDisabled) {
              return {
                error:
                  `golfer count ${desired} disabled on this tee time`,
              };
            }

            const radioInput =
              target.querySelector(
                'input[type="radio"]'
              );

            const clickTarget =
              radioInput || target;

            clickTarget.focus?.();

            clickTarget.dispatchEvent(
              new MouseEvent(
                'mousedown',
                {
                  bubbles: true,
                  cancelable: true,
                }
              )
            );

            clickTarget.dispatchEvent(
              new MouseEvent(
                'mouseup',
                {
                  bubbles: true,
                  cancelable: true,
                }
              )
            );

            clickTarget.dispatchEvent(
              new MouseEvent(
                'click',
                {
                  bubbles: true,
                  cancelable: true,
                }
              )
            );

            if (radioInput) {
              clickTarget.dispatchEvent(
                new Event(
                  'change',
                  {
                    bubbles: true,
                  }
                )
              );
            }

            return {
              selected: desired,
              via: radioInput
                ? 'radio-input'
                : 'span-click',
            };
          },
          golferCount
        );

      if (golferResult.error) {
        const screenshotPath =
          await this.screenshot(
            'golfer-select-error'
          );

        return {
          reached: false,
          error: golferResult.error,
          screenshotPath,
        };
      }

      await this.page.waitForTimeout(1000);

      /*
       * Add reservation to cart.
       */
      const addResult =
        await this.page.evaluate(() => {
          const btn =
            document.querySelector(
              '[data-testid="add-to-cart-button"]'
            );

          if (
            btn &&
            btn.offsetParent !== null
          ) {
            btn.dispatchEvent(
              new MouseEvent(
                'click',
                {
                  bubbles: true,
                  cancelable: true,
                }
              )
            );

            return true;
          }

          return false;
        });

      if (!addResult) {
        const screenshotPath =
          await this.screenshot(
            'add-to-cart-not-found'
          );

        return {
          reached: false,
          error:
            'ADD TO CART button not found',
          screenshotPath,
        };
      }

      await this.page.waitForTimeout(2500);

      /*
       * Open cart.
       */
      await this._dismissModals();

      const cartClicked =
        await this.page.evaluate(() => {
          const badge =
            document.querySelector(
              '.MuiBadge-root, [class*="Badge"]'
            );

          const target = badge
            ? (
                badge.closest('button') ||
                badge
              )
            : null;

          if (target) {
            target.click();
            return true;
          }

          return false;
        });

      if (!cartClicked) {
        const screenshotPath =
          await this.screenshot(
            'cart-icon-not-found'
          );

        return {
          reached: false,
          error: 'cart icon not found',
          screenshotPath,
        };
      }

      await this.page.waitForTimeout(1500);

      /*
       * Checkout.
       */
      const checkoutBtn =
        await this.page.$(
          'button:has-text("CHECKOUT"), button:has-text("Checkout")'
        );

      if (!checkoutBtn) {
        const screenshotPath =
          await this.screenshot(
            'checkout-button-not-found'
          );

        return {
          reached: false,
          error:
            'CHECKOUT button not found',
          screenshotPath,
        };
      }

      await checkoutBtn.evaluate(
        el => el.click()
      );

      await this.page.waitForTimeout(3000);

      await this._checkForBlocks();

      /*
       * Confirm payment page loaded.
       */
      const hasPaymentForm =
        await this.page.evaluate(
          () =>
            /CVV|CVC|Security Code/i.test(
              document.body.innerText
            )
        );

      if (!hasPaymentForm) {
        const screenshotPath =
          await this.screenshot(
            'payment-form-not-found'
          );

        return {
          reached: false,
          error:
            'did not land on payment form',
          screenshotPath,
          checkoutUrl:
            this.page.url(),
        };
      }

      /*
       * THIS IS THE IMPORTANT NEW PART:
       *
       * Fill card number, expiration,
       * sandbox CVV and billing info.
       */
      const paymentFields = fillPayment
        ? await this.fillPaymentForm(paymentCard)
        : {};

      /*
       * Give React/payment UI time to
       * process input/change events.
       */
      await this.page.waitForTimeout(750);

      const screenshotPath = fillPayment ? null : await this.screenshot('checkout-blank');

      // OFF by default. Enable separately from fillPayment to click the
      // final button after payment fields and the required checkbox are ready.
      let confirmation = null;
      let confirmationDetails = null;
      if (completePurchase) {
        await beforePurchase();
        await this.completePurchase();
        try {
          await this.page.getByRole('heading', { name: 'Order Confirmed!', exact: true })
            .waitFor({ state: 'visible', timeout: 30000 });
        } catch {
          // Capture field identifiers, never payment values or billing-page text.
          const invalidFields = await this.page.locator('input[aria-invalid="true"], input:invalid')
            .evaluateAll(inputs => inputs.filter(input => input.getClientRects().length)
              .map(input => input.id || input.name || 'unnamed required input'));
          throw new Error(invalidFields.length
            ? `Purchase not confirmed; invalid fields: ${invalidFields.join(', ')}. Review reservation history.`
            : 'Purchase not confirmed after 30 seconds; no visible invalid inputs. Review reservation history.');
        }
        if (config.confirmationSelector) {
          const marker = this.page.locator(config.confirmationSelector).first();
          await marker.waitFor({ state: 'visible', timeout: 30000 });
        }
        const reservation = this.page.getByTestId('teetime-item-component-0-gncReservationId');
        await reservation.waitFor({ state: 'visible', timeout: 30000 });
        confirmationDetails = verifyConfirmation(await this.page.locator('body').innerText(),
          await reservation.innerText(), expectedSlot, golferCount);
        confirmation = confirmationDetails.reference;
      }
      return {
        reached: true,
        checkoutUrl:
          this.page.url(),
        screenshotPath,
        paymentFields,
        purchaseClicked: completePurchase,
        confirmation,
        confirmationDetails,
      };

    } catch (err) {
      const screenshotPath = fillPayment ? null :
        await this.screenshot(
          'reserve-error'
        ).catch(() => null);

      return {
        reached: false,
        error: err.message,
        screenshotPath,
        blocked: Boolean(err.blocked),
      };
    }
  }

  async reservationHistory() {
    await this.page.goto(`${config.site.baseUrl}/reservation/history`, {waitUntil:'domcontentloaded',timeout:30000});
    const container = this.page.getByTestId('reservations-page-container');
    await container.waitFor({state:'visible',timeout:15000});
    await this.page.waitForFunction(() => {
      const list = document.querySelector('[data-testid="reservations-page-container"]');
      if (!list || list.querySelector('[role="progressbar"]')) return false;
      return list.querySelectorAll('[role="group"]').length > 0 ||
        /no (?:upcoming )?reservations|no (?:upcoming )?bookings/i.test(list.innerText);
    }, null, {timeout:20000});
    const tab = this.page.getByTestId('reservations-tab-upcoming');
    if (await tab.getAttribute('aria-selected') !== 'true') throw new Error('Upcoming reservation history not selected');
    if (await container.getByRole('progressbar').count()) throw new Error('Reservation history is still loading');
    if (await container.getByRole('button', {name:/next|load more/i}).count()) throw new Error('Paginated reservation history needs review');
    const cards = await container.getByRole('group').allInnerTexts();
    if (!cards.length && !/no (?:upcoming )?reservations|no (?:upcoming )?bookings/i.test(await container.innerText())) {
      throw new Error('Reservation history did not provide a complete list');
    }
    return parseHistoryCards(cards);
  }

  async hasPendingCart() {
    const cart = this.page.getByTestId('core-shopping-cart');
    await cart.waitFor({state:'attached',timeout:10000});
    // The loaded history page renders an empty hidden container for no cart.
    // Any rendered cart contents are treated conservatively as a pending hold.
    return await cart.evaluate(element => element.childElementCount > 0 || element.textContent.trim().length > 0);
  }

  async completePurchase() {
    const checkbox = this.page.locator('input[type="checkbox"][name="chb-nm"]');
    await checkbox.check();
    const button = this.page.getByTestId('make-your-reservation-btn');
    await button.waitFor({ state: 'visible' });
    await button.click();
    // A successful click does not prove that payment or booking succeeded.
    // Keep the browser open so the resulting confirmation/error can be reviewed.
  }
}

module.exports = DosLagosSite;
