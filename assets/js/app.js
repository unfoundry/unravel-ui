/**
 * Unravel - Main Application Engine
 * Pure client-side zero-trust tabular data parser, validator, and normalizer.
 */

class UnravelApp {
  constructor() {
    this.projectConfig = null;
    this.currentLayout = null;
    this.currentStep = 1;
    this.totalSteps = 8;
    this.isDirty = false;

    // Parsed Data State
    this.uploadedFile = null;
    this.uploadedFileType = null; // 'xlsx' | 'csv' | 'tsv'
    this.rawWorksheets = {}; // sheetName -> raw 2D array
    this.activeSheetName = null;
    this.rawHeaders = [];
    this.rawMatrix = [];
    this.previewRows = [];
    this.normalizedData = [];
    this.excludedRows = [];
    this.columnMappings = []; // [ { sourceColumn, targetColumn, transforms, dateFormatSource, dateFormatTarget, validations, defaultValue, fallbackIndex } ]
    
    // Undo / Redo & Validation state
    this.historyStack = [];
    this.redoStack = [];
    this.gridErrors = {}; // rowIndex -> { fieldKey: { error, defaultValue } }
    this.activeFilter = 'all'; // 'all', 'errors', or 'valid'

    // Multi-row selection
    this.selectedRowIds = new Set();

    // Browser Collapsible Rules Sidebar
    this.isRulesSidebarOpen = false;

    // Offsets
    this.offsetY = 0;
    this.offsetX = 0;

    // Snapshot of baseline layout for diff computation on save
    this.originalLayoutSnapshot = null;

    // Author & Decryption Settings
    this.author = { username: 'System User', email: 'user@enterprise.org' };
    this.decryptionEndpoint = 'http://127.0.0.1:8001/api/decrypt-xlsx';
    this.appConfig = null;
    this.sheetMatchStatus = { isMatch: true, strategy: 'first_sheet', reason: 'Primary worksheet in workbook selected by default.', details: '' };

    // Metadata Edit Mode
    this.isEditingMetadata = false;

    this.init();
  }

  async init() {
    this.cleanPathname();
    this.initPwa();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.setupWindowUnloadGuard();
    await this.loadAppConfig();
    await this.checkSecurityVault();
    await this.loadAuthorInfo();
    await this.checkUnravelServiceStatus();
    await this.loadDefaultProject();
    this.updateDirtyState(false);
  }

  cleanPathname() {
    try {
      const path = window.location.pathname;
      if (path && path.includes('.html')) {
        let clean = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
        if (!clean) clean = '/';
        const newUrl = clean + window.location.search + window.location.hash;
        window.history.replaceState(null, '', newUrl);
      }
    } catch (e) {
      // Ignored for restricted environments
    }
  }

  clearProjectRouting(clearCache = false) {
    if (clearCache) {
      localStorage.removeItem('unravel_active_project');
      localStorage.removeItem('unravel_active_hash');
    }

    try {
      let cleanPath = window.location.pathname;
      if (cleanPath && cleanPath.includes('.html') && !window.location.protocol.startsWith('file')) {
        cleanPath = cleanPath.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/';
      }
      history.replaceState(null, '', cleanPath);
    } catch (e) {
      try {
        window.location.hash = '';
      } catch (err) {}
    }
  }

  initPwa() {
    this.deferredInstallPrompt = null;

    // 1. Register Service Worker if supported
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
          .then((reg) => {
            console.log('[PWA] Unravel Service Worker active with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }

    // 2. Listen for PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      this.updateInstallUi(true);
    });

    // 3. Listen for successful install
    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      this.updateInstallUi(false);
      this.showToast('🎉 Unravel installed successfully as a progressive web app!');
    });

    // 4. Bind prompt handlers
    const installBtn = document.getElementById('btn-install-app');
    const menuInstallBtn = document.getElementById('menu-install-app');
    const promptHandler = async (e) => {
      if (e) e.preventDefault();
      if (!this.deferredInstallPrompt) {
        // Fallback for browsers that already installed or need manual instructions
        Swal.fire({
          title: 'Install Unravel App',
          html: `
            <p class="text-muted small">
              You can install Unravel directly onto your device:
            </p>
            <ul class="text-start small">
              <li><strong>Chrome / Edge (Desktop):</strong> Click the install icon <i class="bi bi-download"></i> in your browser address bar.</li>
              <li><strong>Safari (iOS / iPad):</strong> Tap the Share button <i class="bi bi-share"></i> and select <em>"Add to Home Screen"</em>.</li>
              <li><strong>Chrome (Android):</strong> Tap the browser menu &gt; <em>"Install App"</em> or <em>"Add to Home screen"</em>.</li>
            </ul>
          `,
          icon: 'info'
        });
        return;
      }
      this.deferredInstallPrompt.prompt();
      const { outcome } = await this.deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        this.showToast('🚀 Installing Unravel...');
      }
      this.deferredInstallPrompt = null;
      this.updateInstallUi(false);
    };

    if (installBtn) installBtn.addEventListener('click', promptHandler);
    if (menuInstallBtn) menuInstallBtn.addEventListener('click', promptHandler);

    // Initial UI check
    this.updateInstallUi(false);
  }

  updateInstallUi(show) {
    const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                         window.navigator.standalone === true;
    const shouldShow = show && !isStandalone;
    const installBtn = document.getElementById('btn-install-app');
    const menuInstallItem = document.getElementById('menu-install-pwa-item');
    if (installBtn) installBtn.classList.toggle('d-none', !shouldShow);
    if (menuInstallItem) menuInstallItem.classList.toggle('d-none', isStandalone);
  }

  getUnravelServiceBaseUrl() {
    if (this.appConfig && this.appConfig.endpoints && this.appConfig.endpoints.unravelServiceUrl) {
      return this.appConfig.endpoints.unravelServiceUrl.replace(/\/+$/, '');
    }
    if (this.appConfig && this.appConfig.unravelServiceUrl) {
      return this.appConfig.unravelServiceUrl.replace(/\/+$/, '');
    }
    if (this.appConfig && this.appConfig.unravelService && this.appConfig.unravelService.serviceUrl) {
      return this.appConfig.unravelService.serviceUrl.replace(/\/+$/, '');
    }
    return 'http://127.0.0.1:8001';
  }

  isUnravelServiceEnabled() {
    if (!this.appConfig) return true;
    if (this.appConfig.features && this.appConfig.features.enableUnravelService === false) return false;
    if (this.appConfig.unravelService && this.appConfig.unravelService.enabled === false) return false;
    return true;
  }

  isDecryptionServiceEnabled() {
    if (!this.isUnravelServiceEnabled()) return false;
    if (this.appConfig && this.appConfig.features && this.appConfig.features.enableDecryptionService === false) return false;
    return true;
  }

  isFileBrokerEnabled() {
    if (!this.isUnravelServiceEnabled()) return false;
    if (this.appConfig && this.appConfig.features && this.appConfig.features.enableFileBroker === false) return false;
    return true;
  }

  isTelemetryEnabled() {
    if (!this.isUnravelServiceEnabled()) return false;
    if (this.appConfig && this.appConfig.features && this.appConfig.features.enableTelemetry === false) return false;
    return true;
  }

  async checkUnravelServiceStatus() {
    const statusEl = document.getElementById('status-unravel-service');
    const badgeEl = document.getElementById('unravel-service-badge');
    const pillsContainer = document.getElementById('unravel-service-projects-pills');
    const brokerBtn = document.getElementById('btn-export-broker');

    if (!this.isUnravelServiceEnabled()) {
      if (statusEl) {
        statusEl.innerHTML = `<i class="bi bi-slash-circle text-muted" style="font-size:0.5rem;"></i> <span class="text-muted" title="Unravel Service disabled in config.json">Unravel Service (Disabled)</span>`;
      }
      if (badgeEl) {
        badgeEl.className = 'badge bg-light text-muted border';
        badgeEl.textContent = 'Disabled in config';
      }
      if (pillsContainer) {
        pillsContainer.innerHTML = '<span class="text-muted small fst-italic">Unravel Service is disabled in config.json. Running in local zero-trust mode.</span>';
      }
      if (brokerBtn) {
        brokerBtn.disabled = true;
        brokerBtn.title = 'Unravel Service Broker is disabled in config.json.';
        brokerBtn.classList.add('opacity-50');
      }
      return;
    }

    const baseUrl = this.getUnravelServiceBaseUrl();
    try {
      const resp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        if (statusEl) {
          statusEl.innerHTML = `<i class="bi bi-circle-fill text-success" style="font-size:0.5rem;"></i> <span class="text-dark fw-semibold">Unravel Service</span> <small class="text-success fw-bold">(Online)</small>`;
        }
        if (badgeEl) {
          badgeEl.className = 'badge bg-success-subtle text-success border border-success-subtle';
          badgeEl.textContent = 'Online';
        }
        if (brokerBtn) {
          const brokerActive = this.isFileBrokerEnabled();
          brokerBtn.disabled = !brokerActive;
          brokerBtn.classList.toggle('opacity-50', !brokerActive);
          brokerBtn.title = brokerActive ? 'Dispatch payload via Unravel Broker' : 'Unravel File Broker is disabled in config.json.';
        }
        await this.loadUnravelServiceProjects(baseUrl);
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (e) {
      if (statusEl) {
        statusEl.innerHTML = `<i class="bi bi-circle-fill text-secondary" style="font-size:0.5rem;"></i> <span class="text-muted">Unravel Service (Offline)</span>`;
      }
      if (badgeEl) {
        badgeEl.className = 'badge bg-light text-secondary border';
        badgeEl.textContent = 'Offline';
      }
      if (pillsContainer) {
        pillsContainer.innerHTML = `<span class="text-muted small fst-italic">Service offline at ${baseUrl}. App operational in local mode.</span>`;
      }
      if (brokerBtn) {
        brokerBtn.disabled = true;
        brokerBtn.title = 'Unravel Service offline. Start unravel_service.py on port 8001 to enable broker.';
      }
    }
  }

  async loadUnravelServiceProjects(baseUrl) {
    const pillsContainer = document.getElementById('unravel-service-projects-pills');
    if (!pillsContainer) return;
    try {
      const resp = await fetch(`${baseUrl}/api/projects`, { signal: AbortSignal.timeout(2000) });
      if (!resp.ok) return;
      const projects = await resp.json();
      if (!projects || projects.length === 0) {
        pillsContainer.innerHTML = '<span class="text-muted small fst-italic">No projects registered in Unravel SQLite store.</span>';
        return;
      }
      pillsContainer.innerHTML = '';
      projects.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-outline-info text-start d-flex align-items-center gap-1 font-monospace';
        btn.innerHTML = `<i class="bi bi-hdd-network"></i> <span><strong>${p.name}</strong> <small class="text-muted">(${p.projectId})</small></span>`;
        btn.addEventListener('click', () => {
          this.fetchProjectFromUnravelService(p.projectId);
        });
        pillsContainer.appendChild(btn);
      });
    } catch (e) {
      console.warn('Could not list Unravel Service projects', e);
    }
  }

  async loadAppConfig() {
    try {
      const resp = await fetch('config.json');
      if (resp.ok) {
        this.appConfig = await resp.json();
      }
    } catch (e) {
      console.info("config.json could not be fetched, using defaults:", e.message);
    }
    this.applyAppConfig();
  }

  resolveAssetPath(assetPath) {
    if (!assetPath) return '';
    const clean = assetPath.trim();
    if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('data:')) {
      return clean;
    }
    const root = (this.appConfig && this.appConfig.appRoot !== undefined)
      ? this.appConfig.appRoot.replace(/\/+$/, '')
      : '/app';

    if (window.location.protocol.startsWith('file')) {
      return clean.replace(/^\/+/, '');
    }

    const stripped = clean.replace(/^\/+/, '');
    let normalized = stripped;
    const rootWithoutSlash = root.replace(/^\/+/, '');
    if (rootWithoutSlash && normalized.startsWith(rootWithoutSlash + '/')) {
      normalized = normalized.substring(rootWithoutSlash.length + 1);
    }
    const prefix = (root === '' || root === '/') ? '' : root;
    return `${prefix}/${normalized}`;
  }

  applyAppConfig() {
    if (!this.appConfig) return;

    const appName = this.appConfig.appName || 'Unravel';
    const appSubtitle = this.appConfig.appSubtitle || 'Tabular Data Ingestion & Normalizer';

    // 1. Endpoints & Unravel Service derivation
    const baseServiceUrl = this.getUnravelServiceBaseUrl();
    const isHybrid = this.appConfig && this.appConfig.features && this.appConfig.features.enableHybridEncryption;
    this.decryptionEndpoint = `${baseServiceUrl}/api/decrypt-xlsx${isHybrid ? '-hybrid' : ''}`;

    // 2. Custom App Name & Document Title
    document.title = `${appName} - ${appSubtitle}`;

    // Update <meta name="description"> to reflect appSubtitle
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.name = 'description';
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = appSubtitle;

    // Header Brand Name
    const brandNameEl = document.getElementById('app-brand-name');
    if (brandNameEl) {
      brandNameEl.textContent = appName;
    } else {
      const brandText = document.querySelector('.ribbon-brand span:not(.ribbon-brand-icon)');
      if (brandText) brandText.textContent = appName;
    }

    // Header Brand Subtitle
    // const brandSubEl = document.getElementById('app-brand-subtitle');
    // if (brandSubEl) {
    //   if (appSubtitle) {
    //     brandSubEl.textContent = appSubtitle;
    //     brandSubEl.classList.remove('d-none');
    //   } else {
    //     brandSubEl.classList.add('d-none');
    //   }
    // }

    // Footer Brand Engine Name
    const footerBrandEl = document.getElementById('app-footer-brand-name');
    if (footerBrandEl) {
      footerBrandEl.textContent = appName;
    }

    // Load Panel Hero Description
    const loadPanelDesc = document.getElementById('app-load-panel-desc');
    if (loadPanelDesc && appSubtitle) {
      loadPanelDesc.textContent = `To begin ingesting and validating datasets with ${appName} (${appSubtitle}), load a project schema definition via URL, upload a local JSON schema, or pick a starter template.`;
    }

    // 3. Brand Logo & Favicon: Image takes precedence over Icon
    const brandIconContainer = document.getElementById('app-brand-icon') || document.querySelector('.ribbon-brand-icon');
    let resolvedFavicon = '';

    if (this.appConfig.appLogoImage && this.appConfig.appLogoImage.trim()) {
      const imgSrc = this.resolveAssetPath(this.appConfig.appLogoImage);
      resolvedFavicon = imgSrc;
      if (brandIconContainer) {
        brandIconContainer.innerHTML = `<img src="${imgSrc}" alt="${appName} Logo" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px;">`;
        brandIconContainer.style.background = 'transparent';
        brandIconContainer.style.boxShadow = 'none';
      }
    } else if (this.appConfig.appLogoIcon && this.appConfig.appLogoIcon.trim()) {
      let iconClass = this.appConfig.appLogoIcon.trim();
      if (!iconClass.startsWith('bi-') && !iconClass.startsWith('bi ')) {
        iconClass = `bi-${iconClass}`;
      }
      if (!iconClass.includes('bi ')) {
        iconClass = `bi ${iconClass}`;
      }
      if (brandIconContainer) {
        brandIconContainer.innerHTML = `<i class="${iconClass}"></i>`;
        brandIconContainer.style.background = '';
        brandIconContainer.style.boxShadow = '';
      }
      resolvedFavicon = this.resolveAssetPath('assets/icons/icon-solo.svg');
    }

    // Dynamic Favicon Update
    if (resolvedFavicon) {
      let favicon = document.getElementById('app-favicon') || document.querySelector("link[rel*='icon']");
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.id = 'app-favicon';
        document.head.appendChild(favicon);
      }
      favicon.href = resolvedFavicon;
      favicon.type = resolvedFavicon.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    }

    // 4. Update About Menu Links
    const aboutLinks = document.querySelectorAll('.app-about-link');
    aboutLinks.forEach(link => {
      link.innerHTML = `<i class="bi bi-info-circle"></i> About ${appName}`;
      link.onclick = (e) => {
        e.preventDefault();
        Swal.fire({
          title: `About ${appName}`,
          text: `${appSubtitle}. Zero-Trust Modular Tabular Ingestion & Normalization Engine for Enterprise Datasets.`,
          icon: 'info',
          confirmButtonColor: '#158cba'
        });
      };
    });

    // 5. Theme CSS variables injection
    if (this.appConfig.theme) {
      const root = document.documentElement;
      const t = this.appConfig.theme;
      if (t.primary) root.style.setProperty('--unravel-primary', t.primary);
      if (t.primaryDark) root.style.setProperty('--unravel-primary-dark', t.primaryDark);
      if (t.primaryLight) root.style.setProperty('--unravel-primary-light', t.primaryLight);
      if (t.accent) root.style.setProperty('--unravel-accent', t.accent);
      if (t.success) root.style.setProperty('--unravel-success', t.success);
      if (t.warning) root.style.setProperty('--unravel-warning', t.warning);
      if (t.danger) root.style.setProperty('--unravel-danger', t.danger);
      if (t.surface) root.style.setProperty('--unravel-surface', t.surface);
      if (t.border) root.style.setProperty('--unravel-border', t.border);
    }

    // 6. Feature: Enable/Disable Sample Data Files, Sample Schemas & Starter Templates
    const enableSamples = (this.appConfig.features && this.appConfig.features.enableSamples !== undefined)
      ? !!this.appConfig.features.enableSamples
      : true;

    const sampleSchemaContainer = document.getElementById('quick-sample-schema-container');
    if (sampleSchemaContainer) {
      sampleSchemaContainer.classList.toggle('d-none', !enableSamples);
    }

    const starterTemplatesContainer = document.getElementById('starter-templates-container');
    if (starterTemplatesContainer) {
      starterTemplatesContainer.classList.toggle('d-none', !enableSamples);
    }

    const sampleFilesContainer = document.getElementById('sample-files-container');
    if (sampleFilesContainer) {
      sampleFilesContainer.classList.toggle('d-none', !enableSamples);
    }

    const schemaUrlInput = document.getElementById('input-schema-url');
    if (schemaUrlInput && !enableSamples) {
      schemaUrlInput.placeholder = 'https://domain.org/schema.json or local URL';
    }
  }

  // =========================================================================
  // 1. SECURITY & VAULT AUTHENTICATION
  // =========================================================================

  async checkSecurityVault() {
    const sec = window.UnravelSecurity;
    if (!sec) return;

    // Security vault is an opt-in enterprise feature
    const vaultEnabled = this.appConfig?.features?.enableSecurityVault === true;
    if (!vaultEnabled) return;

    while (true) {
      if (!sec.hasVaultPassword()) {
        const { value: formValues } = await Swal.fire({
          title: '🔒 Secure Storage Vault Setup',
          html: `
            <p class="text-muted small text-start mb-3">
              To ensure zero-trust compliance for confidential data, please create a local browser password.
              This encrypts cached dataset profiles in your browser's private storage.
            </p>
            <div class="mb-3 text-start">
              <label class="form-label small fw-bold">Master Vault Password</label>
              <input id="swal-pass1" type="password" class="form-control" placeholder="Choose a strong password" autocomplete="new-password">
            </div>
            <div class="text-start">
              <label class="form-label small fw-bold">Confirm Password</label>
              <input id="swal-pass2" type="password" class="form-control" placeholder="Re-enter password" autocomplete="new-password">
            </div>
          `,
          focusConfirm: false,
          confirmButtonText: 'Set Password & Unlock',
          confirmButtonColor: '#005eb8',
          allowOutsideClick: false,
          allowEscapeKey: false,
          preConfirm: () => {
            const p1 = document.getElementById('swal-pass1')?.value || '';
            const p2 = document.getElementById('swal-pass2')?.value || '';
            if (!p1 || p1.length < 6) {
              Swal.showValidationMessage('Password must be at least 6 characters');
              return false;
            }
            if (p1 !== p2) {
              Swal.showValidationMessage('Passwords do not match');
              return false;
            }
            return p1;
          }
        });

        if (formValues) {
          await sec.setupVaultPassword(formValues);
          await Swal.fire({
            icon: 'success',
            title: 'Vault Configured',
            text: 'Session authenticated. Data processing will remain encrypted client-side.',
            timer: 1800,
            showConfirmButton: false
          });
          break;
        }
      } else if (!sec.isSessionUnlocked()) {
        let forgotPasswordRequested = false;

        const { value: pass } = await Swal.fire({
          title: '🔒 Unlock Unravel Vault',
          html: `
            <p class="text-muted small text-start mb-3">
              Enter your local browser password to resume ingestion workspace.
            </p>
            <div class="mb-3 text-start">
              <label class="form-label small fw-bold">Master Vault Password</label>
              <input id="swal-unlock-pass" type="password" class="form-control" placeholder="Enter master password" autocomplete="current-password">
            </div>
            <div class="d-flex justify-content-between align-items-center mt-3 pt-2 border-top">
              <button type="button" id="swal-btn-forgot-password" class="btn btn-link btn-sm text-danger text-decoration-none p-0">
                <i class="bi bi-question-circle me-1"></i>Forgot Password? Reset Vault
              </button>
            </div>
          `,
          focusConfirm: false,
          confirmButtonText: 'Unlock Session',
          confirmButtonColor: '#005eb8',
          allowOutsideClick: false,
          allowEscapeKey: false,
          didOpen: () => {
            const passInput = document.getElementById('swal-unlock-pass');
            if (passInput) {
              passInput.focus();
              passInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  Swal.clickConfirm();
                }
              });
            }
            const forgotBtn = document.getElementById('swal-btn-forgot-password');
            if (forgotBtn) {
              forgotBtn.addEventListener('click', (e) => {
                e.preventDefault();
                forgotPasswordRequested = true;
                Swal.close();
              });
            }
          },
          preConfirm: async () => {
            if (forgotPasswordRequested) return null;
            const passInput = document.getElementById('swal-unlock-pass');
            const val = passInput ? passInput.value : '';
            if (!val) {
              Swal.showValidationMessage('Password cannot be empty');
              return false;
            }
            const valid = await sec.verifyVaultPassword(val);
            if (!valid) {
              Swal.showValidationMessage('Incorrect vault password');
              return false;
            }
            return val;
          }
        });

        if (forgotPasswordRequested) {
          const confirmResult = await Swal.fire({
            icon: 'warning',
            title: 'Forgot Vault Password?',
            html: `
              <p class="text-muted small mb-2">
                Forgot your master password? Resetting will clear saved vault passwords and browser local storage, allowing you to start fresh and set a new password.
              </p>
              <div class="alert alert-warning text-start small mb-0">
                <i class="bi bi-exclamation-triangle-fill me-1"></i>
                <strong>Notice:</strong> All locally cached project settings, layouts, and session data in browser storage will be cleared.
              </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Yes, Reset Vault & Clear Storage',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            reverseButtons: true,
            focusCancel: true
          });

          if (confirmResult.isConfirmed) {
            sec.resetVault();
            await Swal.fire({
              icon: 'info',
              title: 'Vault & Storage Cleared',
              text: 'Saved password and local storage have been reset. You can now set up a new password.',
              timer: 1800,
              showConfirmButton: false
            });
            // Loop automatically repeats and hits !sec.hasVaultPassword() branch
          }
          continue;
        }

        if (pass) {
          Swal.fire({
            icon: 'success',
            title: 'Welcome Back',
            text: 'Local vault decrypted.',
            timer: 1500,
            showConfirmButton: false
          });
          break;
        }
      } else {
        break;
      }
    }
  }

  async promptResetVault() {
    const sec = window.UnravelSecurity;
    if (!sec) return;

    const confirmResult = await Swal.fire({
      icon: 'warning',
      title: 'Reset Vault & Clear Storage?',
      html: `
        <p class="text-muted small mb-2">
          Resetting will clear your saved master password, encryption keys, and browser local storage so you can start fresh with a new password.
        </p>
        <div class="alert alert-warning text-start small mb-0">
          <i class="bi bi-exclamation-triangle-fill me-1"></i>
          <strong>Notice:</strong> All locally cached project configurations, mappings, and session data in browser storage will be cleared.
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Yes, Reset Vault & Clear Storage',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      reverseButtons: true,
      focusCancel: true
    });

    if (confirmResult.isConfirmed) {
      sec.resetVault();
      await Swal.fire({
        icon: 'info',
        title: 'Vault & Storage Cleared',
        text: 'Vault and local storage have been reset. Reloading workspace to set new passwords...',
        timer: 1800,
        showConfirmButton: false
      });
      window.location.reload();
    }
  }

  // =========================================================================
  // 2. PROJECT SCHEMA MANAGEMENT & PERSISTENCE
  // =========================================================================

  async loadAuthorInfo() {
    const userInfoUrl = (this.appConfig && this.appConfig.endpoints && this.appConfig.endpoints.userInfoUrl)
      ? this.appConfig.endpoints.userInfoUrl
      : 'assets/sample-data/user-info.json';
    try {
      const resp = await fetch(userInfoUrl);
      if (resp.ok) {
        this.author = await resp.json();
        const authorEl = document.getElementById('author-display');
        if (authorEl) {
          authorEl.textContent = `${this.author.name || this.author.username || 'User'}`;
        }
      }
    } catch (e) {
      console.warn("Could not fetch user-info from " + userInfoUrl, e);
    }
  }

  async loadDefaultProject() {
    this.cleanPathname();
    await this.loadStarterTemplates();

    const hash = window.location.hash || '';

    // 1. Check Hash: /#/url/<json url>
    if (hash.startsWith('#/url/')) {
      const url = decodeURIComponent(hash.substring(6));
      if (url) {
        await this.fetchSchemaFromUrl(url, false);
        return;
      }
    }

    // 2. Check Hash: /#/project/<project-id>
    if (hash.startsWith('#/project/')) {
      const projectId = decodeURIComponent(hash.substring(10));
      if (projectId) {
        if (!this.isUnravelServiceEnabled()) {
          // If a cached project matching this ID exists in localStorage, recover it
          const cached = localStorage.getItem('unravel_active_project');
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              if (parsed.projectId === projectId || parsed.id === projectId) {
                this.projectConfig = parsed;
                this.applyLoadedProject(true);
                return;
              }
            } catch (e) {}
          }
          // Otherwise immediately clean the route so constant refreshes don't loop
          this.clearProjectRouting();
          Swal.fire({
            icon: 'warning',
            title: 'Unravel Service Disabled',
            text: `Project ID "${projectId}" requires Unravel Service, but it is disabled in config.json. Active routing has been reset.`,
            confirmButtonColor: '#158cba'
          });
          this.showLoadProjectPanel();
          return;
        }
        await this.fetchProjectFromUnravelService(projectId);
        return;
      }
    }

    // 3. Check query param: ?schema=... or ?url=...
    const params = new URLSearchParams(window.location.search);
    const schemaUrlParam = params.get('schema') || params.get('url');
    if (schemaUrlParam) {
      await this.fetchSchemaFromUrl(schemaUrlParam, true);
      return;
    }
    const projectParam = params.get('project');
    if (projectParam) {
      await this.fetchProjectFromUnravelService(projectParam);
      return;
    }

    // 4. Check cached project in localStorage (refresh persistence)
    const cached = localStorage.getItem('unravel_active_project');
    if (cached) {
      try {
        this.projectConfig = JSON.parse(cached);
        const cachedHash = localStorage.getItem('unravel_active_hash');
        if (cachedHash && !window.location.hash) {
          window.location.hash = cachedHash;
        }
        this.applyLoadedProject(false);
        return;
      } catch (e) {
        console.warn("Invalid cached project JSON", e);
        this.clearProjectRouting();
      }
    }

    // 5. Config defaultSchemaUrl (if configured)
    if (this.appConfig && this.appConfig.defaultSchemaUrl) {
      await this.fetchSchemaFromUrl(this.appConfig.defaultSchemaUrl, true);
      return;
    }

    // 6. Default clean state: No project loaded
    this.projectConfig = null;
    this.clearProjectRouting();
    this.showLoadProjectPanel();
    this.updateStepperReadyState();
  }

  async loadStarterTemplates() {
    try {
      const res = await fetch('assets/sample-data/starter-templates.json');
      if (!res.ok) return;
      const templates = await res.json();
      const container = document.getElementById('starter-templates-pills');
      if (!container) return;
      container.innerHTML = '';
      templates.forEach(tpl => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-outline-primary text-start d-flex align-items-center gap-2';
        btn.innerHTML = `<i class="bi ${tpl.icon || 'bi-filetype-json'}"></i> <span><strong>${tpl.name}</strong> <small class="text-muted">(${tpl.badge || 'Template'})</small></span>`;
        btn.addEventListener('click', () => {
          this.projectConfig = tpl.schema;
          this.clearProjectRouting();
          this.applyLoadedProject(true);
          this.showToast(`Loaded template: ${tpl.name}`);
        });
        container.appendChild(btn);
      });
    } catch (e) {
      console.warn("Could not load starter-templates.json", e);
    }
  }

  async fetchSchemaFromUrl(url, updateHash = true) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      this.projectConfig = await res.json();
      if (updateHash) {
        window.location.hash = `#/url/${encodeURIComponent(url)}`;
      }
      localStorage.setItem('unravel_active_hash', window.location.hash);
      this.applyLoadedProject(true);
      this.showToast(`Schema loaded successfully from URL`);
    } catch (err) {
      console.error("Failed to load schema from URL", err);
      this.clearProjectRouting();
      Swal.fire({
        icon: 'error',
        title: 'Schema Load Failed',
        text: `Unable to fetch schema from "${url}": ${err.message}`,
        confirmButtonColor: '#158cba'
      });
      this.showLoadProjectPanel();
    }
  }

  async fetchProjectFromUnravelService(projectId) {
    if (!this.isUnravelServiceEnabled()) {
      this.clearProjectRouting();
      Swal.fire({
        icon: 'warning',
        title: 'Unravel Service Disabled',
        text: `Project ID "${projectId}" requires Unravel Service, but it is disabled in config.json. Active routing has been reset.`,
        confirmButtonColor: '#158cba'
      });
      this.showLoadProjectPanel();
      return;
    }

    const baseUrl = this.getUnravelServiceBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      this.projectConfig = await res.json();
      window.location.hash = `#/project/${encodeURIComponent(projectId)}`;
      localStorage.setItem('unravel_active_hash', window.location.hash);
      this.applyLoadedProject(true);
      this.showToast(`Loaded project "${this.projectConfig.name || projectId}" from Unravel Service`);
    } catch (err) {
      console.error("Failed to fetch project from Unravel Service", err);
      this.clearProjectRouting();
      Swal.fire({
        icon: 'error',
        title: 'Unravel Service Project Load Failed',
        text: `Unable to load project "${projectId}" from Unravel Service at ${baseUrl}: ${err.message}`,
        confirmButtonColor: '#158cba'
      });
      this.showLoadProjectPanel();
    }
  }

  async closeProject() {
    if (this.projectConfig && this.isDirty) {
      const result = await Swal.fire({
        title: 'Unsaved Changes',
        text: 'You have unsaved changes in your project schema. Do you want to save before closing?',
        icon: 'warning',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Save & Close',
        denyButtonText: 'Close Without Saving',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#158cba',
        denyButtonColor: '#d33'
      });

      if (result.isConfirmed) {
        await this.saveProjectToDisk();
      } else if (result.isDismissed) {
        return;
      }
    }

    // Clear in-memory state
    this.projectConfig = null;
    this.currentLayout = null;
    this.originalLayoutSnapshot = null;
    this.columnMappings = [];
    this.uploadedFile = null;
    this.uploadedFileType = null;
    this.rawWorksheets = {};
    this.activeSheetName = null;
    this.rawHeaders = [];
    this.rawMatrix = [];
    this.normalizedData = null;
    this.gridErrors = {};
    this.activeFilter = 'all';

    // Clear cached storage & strip all URL appendages (hash, query params)
    this.clearProjectRouting();

    // Reset upload inputs & indicators
    const fileInput = document.getElementById('source-file-input');
    if (fileInput) fileInput.value = '';
    const successBadge = document.getElementById('file-drop-success');
    if (successBadge) successBadge.classList.add('d-none');
    const fileNameEl = document.getElementById('uploaded-file-name');
    if (fileNameEl) fileNameEl.textContent = '';
    const fileInspectDetails = document.getElementById('file-inspect-details');
    if (fileInspectDetails) fileInspectDetails.classList.add('d-none');

    this.updateDirtyState(false);
    this.showLoadProjectPanel();
    this.jumpToStep(1);
    this.showToast('Project closed and workspace reset');
  }

  showLoadProjectPanel() {
    const loadPanel = document.getElementById('project-load-panel');
    const detailsPanel = document.getElementById('project-details-panel');
    if (loadPanel) loadPanel.classList.remove('d-none');
    if (detailsPanel) detailsPanel.classList.add('d-none');
    const titleNav = document.getElementById('project-title-nav');
    if (titleNav) titleNav.textContent = 'No Project Loaded';
    const verBadge = document.getElementById('project-version-badge');
    if (verBadge) verBadge.textContent = '—';
    this.updateStepperReadyState();
  }

  showProjectDetailsPanel() {
    const loadPanel = document.getElementById('project-load-panel');
    const detailsPanel = document.getElementById('project-details-panel');
    if (loadPanel) loadPanel.classList.add('d-none');
    if (detailsPanel) detailsPanel.classList.remove('d-none');
    this.updateStepperReadyState();
  }

  applyLoadedProject(saveCache = true) {
    if (!this.projectConfig) return;

    if (saveCache) {
      const jsonStr = JSON.stringify(this.projectConfig);
      localStorage.setItem('unravel_active_project', jsonStr);
      if (window.location.hash) {
        localStorage.setItem('unravel_active_hash', window.location.hash);
      }
    }

    this.showProjectDetailsPanel();

    document.getElementById('project-title-nav').textContent = this.projectConfig.name || 'Untitled Project';
    document.getElementById('project-version-badge').textContent = `v${this.projectConfig.version || '1.0.0'}`;
    
    document.getElementById('proj-meta-name').value = this.projectConfig.name || '';
    document.getElementById('proj-meta-id').value = this.projectConfig.projectId || '';
    document.getElementById('proj-meta-version').value = this.projectConfig.version || '';
    document.getElementById('proj-meta-url').value = (this.projectConfig.destination && this.projectConfig.destination.postUrl) ? this.projectConfig.destination.postUrl : '';
    
    const authVal = (this.projectConfig.destination && this.projectConfig.destination.headers) ? (this.projectConfig.destination.headers.Authorization || '') : '';
    const tokenInput = document.getElementById('proj-meta-token');
    if (tokenInput) tokenInput.value = authVal.replace(/^Bearer\s+/i, '');

    this.renderLayoutSelector();
    this.renderTargetColumnsPreview();
    if (this.currentLayout) {
      this.originalLayoutSnapshot = JSON.parse(JSON.stringify(this.currentLayout));
    }
    this.updateDirtyState(false);
    this.updateStepperReadyState();
  }

  toggleEditMetadata() {
    this.isEditingMetadata = !this.isEditingMetadata;
    const nameInput = document.getElementById('proj-meta-name');
    const idInput = document.getElementById('proj-meta-id');
    const versionInput = document.getElementById('proj-meta-version');
    const urlInput = document.getElementById('proj-meta-url');
    const tokenInput = document.getElementById('proj-meta-token');
    const btnText = document.getElementById('btn-edit-meta-text');
    const hint = document.getElementById('meta-save-hint');

    if (this.isEditingMetadata) {
      nameInput.removeAttribute('readonly');
      idInput.removeAttribute('readonly');
      versionInput.removeAttribute('readonly');
      urlInput.removeAttribute('readonly');
      if (tokenInput) tokenInput.removeAttribute('readonly');
      nameInput.focus();
      btnText.textContent = 'Lock Metadata';
      hint.classList.remove('d-none');
    } else {
      nameInput.setAttribute('readonly', 'true');
      idInput.setAttribute('readonly', 'true');
      versionInput.setAttribute('readonly', 'true');
      urlInput.setAttribute('readonly', 'true');
      if (tokenInput) tokenInput.setAttribute('readonly', 'true');
      btnText.textContent = 'Edit Metadata';
      hint.classList.add('d-none');

      if (this.projectConfig) {
        this.projectConfig.name = nameInput.value;
        this.projectConfig.projectId = idInput.value;
        this.projectConfig.version = versionInput.value;
        if (!this.projectConfig.destination) this.projectConfig.destination = {};
        this.projectConfig.destination.postUrl = urlInput.value;
        if (tokenInput && tokenInput.value.trim()) {
          if (!this.projectConfig.destination.headers) this.projectConfig.destination.headers = { "Content-Type": "application/json" };
          const raw = tokenInput.value.trim();
          this.projectConfig.destination.headers.Authorization = raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
        }

        document.getElementById('project-title-nav').textContent = this.projectConfig.name;
        document.getElementById('project-version-badge').textContent = `v${this.projectConfig.version}`;
        this.updateDirtyState(true);
        this.showToast('Project metadata updated');
      }
    }
  }

  renderLayoutSelector() {
    const container = document.getElementById('layout-card-container');
    if (!container || !this.projectConfig || !this.projectConfig.layouts) return;

    container.innerHTML = '';

    this.projectConfig.layouts.forEach((layout) => {
      const card = document.createElement('div');
      card.className = `col-md-6 mb-3`;
      card.innerHTML = `
        <div class="glass-card p-3 h-100 layout-select-card cursor-pointer border ${this.currentLayout && this.currentLayout.id === layout.id ? 'border-primary' : ''}" data-layout-id="${layout.id}">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="badge bg-primary text-uppercase">${layout.fileType}</span>
            <span class="badge bg-light text-dark border">${(layout.mappings || []).length} Mappings</span>
          </div>
          <h6 class="fw-bold mb-1 text-dark">${layout.name}</h6>
          <p class="text-muted small mb-2">Sheet Strategy: <code>${layout.sheetStrategy ? layout.sheetStrategy.mode : 'first_sheet'}</code></p>
          <div class="small text-secondary">
            <i class="bi bi-arrow-right-circle text-primary"></i> ${layout.offset ? `Header Row Y: ${layout.offset.offsetY}` : 'Auto-detect'}
          </div>
        </div>
      `;
      card.querySelector('.layout-select-card').addEventListener('click', () => {
        this.selectLayout(layout.id);
      });
      container.appendChild(card);
    });

    if (this.projectConfig.layouts.length > 0 && !this.currentLayout) {
      this.selectLayout(this.projectConfig.layouts[0].id);
    }
  }

  renderTargetColumnsPreview() {
    const statsContainer = document.getElementById('target-columns-stats');
    const tableContainer = document.getElementById('target-columns-table-container');
    if (!tableContainer || !this.projectConfig || !this.projectConfig.targetColumns) return;

    const targetCols = this.projectConfig.targetColumns || [];
    const totalCount = targetCols.length;
    const requiredCount = targetCols.filter(c => c.required).length;
    const optionalCount = targetCols.filter(c => !c.required).length;

    if (statsContainer) {
      statsContainer.innerHTML = `
        <span class="badge bg-secondary-subtle text-secondary border font-monospace px-2 py-1">${totalCount} Total Columns</span>
        <span class="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace px-2 py-1">${requiredCount} Required</span>
        <span class="badge bg-light text-muted border font-monospace px-2 py-1">${optionalCount} Optional</span>
      `;
    }

    const escape = (s) => (s === undefined || s === null ? '' : String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));

    let html = `
      <div class="table-responsive border rounded bg-white shadow-sm" style="max-height: 420px; overflow-x: auto;">
        <table class="table table-bordered table-sm align-middle mb-0 font-monospace text-nowrap" style="font-size: 0.82rem; min-width: 650px;">
          <thead class="table-light">
            <tr>
              <th class="bg-light text-secondary fw-bold px-3 py-2" style="width: 170px; min-width: 170px; position: sticky; left: 0; z-index: 2;">Target Schema</th>
              ${targetCols.map(c => `
                <th style="min-width: 180px;" class="px-3 py-2">
                  <div class="d-flex align-items-center gap-1 mb-1">
                    <span class="badge ${c.required ? 'bg-primary' : 'bg-secondary'}">${c.required ? 'Required' : 'Optional'}</span>
                  </div>
                  <div class="fw-bold text-dark font-sans">${escape(c.label)}</div>
                  <code class="text-muted small">${escape(c.key)}</code>
                </th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="table-info-subtle">
              <td class="bg-light text-secondary fw-bold px-3 py-2" style="width: 170px; min-width: 170px; position: sticky; left: 0; z-index: 1;">
                <i class="bi bi-arrow-return-right text-primary me-1"></i> Row 1: Default Values
              </td>
              ${targetCols.map(c => `
                <td class="px-3 py-2 text-dark" style="min-width: 180px;">
                  ${(c.defaultValue !== undefined && c.defaultValue !== '') 
                    ? `<span class="badge bg-light text-dark border font-monospace">${escape(String(c.defaultValue))}</span>` 
                    : '<span class="text-muted fst-italic small">(empty string "")</span>'}
                </td>
              `).join('')}
            </tr>
            <tr>
              <td class="bg-light text-secondary fw-bold px-3 py-2" style="width: 170px; min-width: 170px; position: sticky; left: 0; z-index: 1;">
                <i class="bi bi-shield-check text-success me-1"></i> Validation Rules
              </td>
              ${targetCols.map(c => {
                const rules = c.defaultValidations || c.validations || [];
                return `
                  <td class="px-3 py-2" style="min-width: 180px;">
                    ${rules.length > 0 
                      ? rules.map(r => `<span class="badge bg-info-subtle text-info-emphasis border border-info-subtle me-1 mb-1">${escape(typeof r === 'string' ? r : r.type)}</span>`).join('') 
                      : '<span class="text-muted fst-italic small">None</span>'}
                  </td>
                `;
              }).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `;

    tableContainer.innerHTML = html;
  }

  selectLayout(layoutId) {
    const match = (this.projectConfig.layouts || []).find(l => l.id === layoutId);
    if (!match) return;

    this.currentLayout = match;
    this.originalLayoutSnapshot = JSON.parse(JSON.stringify(match));

    document.querySelectorAll('.layout-select-card').forEach(el => {
      if (el.dataset.layoutId === layoutId) {
        el.classList.add('border-primary', 'shadow-sm');
        el.style.backgroundColor = 'rgba(0, 94, 184, 0.05)';
      } else {
        el.classList.remove('border-primary', 'shadow-sm');
        el.style.backgroundColor = '';
      }
    });

    this.updateStepperReadyState();

    if (this.currentLayout.sheetStrategy) {
      document.getElementById('sheet-strategy-mode').value = this.currentLayout.sheetStrategy.mode || 'first_sheet';
      document.getElementById('sheet-preset-name').value = this.currentLayout.sheetStrategy.presetName || '';
      document.getElementById('sheet-regex-pattern').value = this.currentLayout.sheetStrategy.regexPattern || '';
      document.getElementById('sheet-date-pattern').value = this.currentLayout.sheetStrategy.dateFormatString || 'YYYY-MM-DD';
      this.handleSheetStrategyModeChange();
    }

    if (this.currentLayout.offset) {
      document.getElementById('offset-y').value = this.currentLayout.offset.offsetY || 0;
      document.getElementById('offset-x').value = this.currentLayout.offset.offsetX || 0;
      document.getElementById('auto-detect-header').checked = !!this.currentLayout.offset.autoDetect;
      this.offsetY = parseInt(this.currentLayout.offset.offsetY) || 0;
      this.offsetX = parseInt(this.currentLayout.offset.offsetX) || 0;
    }

    this.showToast(`Layout selected: ${this.currentLayout.name}`);
  }

  // =========================================================================
  // 3. STEPPER, VALIDATION GATES & AUTO-CRUISE PIPELINE
  // =========================================================================

  /**
   * Determine whether a step is applicable
   * Rule: Any XLSX/XLS workbook MUST show the Worksheet step (Step 4),
   * even if it has only 1 sheet (it will be auto-selected and displayed).
   * Only delimited flat files (.csv, .tsv, .txt) skip Step 4.
   */
  isStepApplicable(stepNumber) {
    if (stepNumber === 4) {
      const isDelimited = this.uploadedFileType === 'csv' || this.uploadedFileType === 'tsv' ||
        (this.currentLayout && ['csv', 'tsv', 'txt'].includes(this.currentLayout.fileType.toLowerCase()) && !this.uploadedFileType);
      if (isDelimited) {
        return false;
      }
    }
    return true;
  }

  /**
   * Gatekeeper: verify conditions required before entering or advancing a step
   */
  validateStepPrerequisites(targetStep) {
    if (targetStep >= 2 && !this.projectConfig) {
      Swal.fire({ icon: 'warning', title: 'No Project Loaded', text: 'Please load a project schema first.', confirmButtonColor: '#005eb8' });
      return false;
    }
    if (targetStep >= 3 && !this.currentLayout) {
      Swal.fire({ icon: 'warning', title: 'Select Format Profile', text: 'Please choose a supplier layout in Step 2 before proceeding.', confirmButtonColor: '#005eb8' });
      return false;
    }
    if (targetStep >= 4 && (!this.rawWorksheets || Object.keys(this.rawWorksheets).length === 0)) {
      Swal.fire({ icon: 'info', title: 'Upload File Required', text: 'Please upload or drop your data file in Step 3 before proceeding.', confirmButtonColor: '#005eb8' });
      return false;
    }
    if (targetStep >= 5) {
      if (this.isStepApplicable(4)) {
        if (!this.activeSheetName || !this.sheetMatchStatus || !this.sheetMatchStatus.isMatch || !this.rawWorksheets || !this.rawWorksheets[this.activeSheetName]) {
          Swal.fire({
            icon: 'warning',
            title: 'Worksheet Required',
            text: 'Please select a worksheet in Step 4 by clicking one of the worksheet badges or specifying a matching pattern before continuing.',
            confirmButtonColor: '#005eb8'
          });
          return false;
        }
      }
    }
    if (targetStep >= 6) {
      // Offset verification: Ensure headers were detected
      if (!this.rawHeaders || this.rawHeaders.length === 0) {
        Swal.fire({
          icon: 'warning',
          title: 'Headers Not Detected',
          text: 'No headers were detected at the current offset. Please adjust the Header Row offset in Step 5 before proceeding.',
          confirmButtonColor: '#005eb8'
        });
        return false;
      }
    }
    if (targetStep >= 7) {
      if (this.currentStep === 6 && document.querySelectorAll('.mapping-source-select').length > 0) {
        this.syncCurrentMappingsFromUI();
      }

      const targetCols = this.projectConfig.targetColumns || [];
      const requiredCols = targetCols.filter(c => c.required);

      const mappedTargets = (this.columnMappings || [])
        .filter(m => m.sourceColumn && m.sourceColumn.trim().length > 0)
        .map(m => m.targetColumn);
      
      const unmapped = requiredCols.filter(c => !mappedTargets.includes(c.key));
      if (unmapped.length > 0) {
        const names = unmapped.map(c => `• <strong>${c.label}</strong> (<code>${c.key}</code>)`).join('<br>');
        Swal.fire({
          icon: 'error',
          title: 'Required Columns Unmapped',
          html: `
            <p class="small text-muted mb-2">The following required columns must be mapped to a source file column before proceeding to the Validation stage:</p>
            <div class="text-danger small text-start p-2 bg-light rounded border border-danger-subtle">${names}</div>
            <p class="small text-secondary mt-2 mb-0">Please map all required columns to continue.</p>
          `,
          confirmButtonColor: '#005eb8'
        });
        return false;
      }
    }
    return true;
  }

  isCurrentStepReady(step = this.currentStep) {
    if (step === 1) {
      return !!(this.projectConfig && this.projectConfig.targetColumns && this.projectConfig.targetColumns.length > 0);
    }
    if (step === 2) {
      return !!this.currentLayout;
    }
    if (step === 3) {
      return !!this.uploadedFile;
    }
    if (step === 4) {
      if (!this.isStepApplicable(4)) return true;
      return !!(this.activeSheetName && this.sheetMatchStatus && this.sheetMatchStatus.isMatch && this.rawWorksheets && this.rawWorksheets[this.activeSheetName]);
    }
    if (step === 5) {
      return !!(this.rawHeaders && this.rawHeaders.length > 0);
    }
    if (step === 6) {
      if (!this.projectConfig || !this.columnMappings || this.columnMappings.length === 0) return false;
      const targetCols = this.projectConfig.targetColumns || [];
      const requiredCols = targetCols.filter(c => c.required);
      const mappedTargets = this.columnMappings
        .filter(m => m.sourceColumn && m.sourceColumn.trim().length > 0)
        .map(m => m.targetColumn);
      const unmappedRequired = requiredCols.filter(c => !mappedTargets.includes(c.key));
      return unmappedRequired.length === 0;
    }
    if (step === 7) {
      return !!(this.normalizedData && this.normalizedData.length > 0);
    }
    if (step === 8) {
      return true;
    }
    return false;
  }

  updateStepperReadyState() {
    for (let i = 1; i <= this.totalSteps; i++) {
      const node = document.getElementById(`step-node-${i}`);
      if (node) {
        if (i === this.currentStep && this.isCurrentStepReady(i)) {
          node.classList.add('ready');
        } else {
          node.classList.remove('ready');
        }
      }
    }
  }

  jumpToStep(stepNumber, direction = 1) {
    if (stepNumber < 1 || stepNumber > this.totalSteps) return;

    // Check entry prerequisites
    if (!this.validateStepPrerequisites(stepNumber)) {
      return;
    }

    // Auto-skip irrelevant steps (like Step 4 for CSV/TSV)
    if (!this.isStepApplicable(stepNumber)) {
      const nextTarget = direction >= 0 ? stepNumber + 1 : stepNumber - 1;
      this.showToast(`Step ${stepNumber} is not applicable for flat files — automatically bypassed.`);
      this.jumpToStep(nextTarget, direction);
      return;
    }

    this.currentStep = stepNumber;

    // Rules sidebar is ONLY visible in Step 7
    const rulesSidebar = document.getElementById('rules-sidebar');
    if (rulesSidebar && this.currentStep !== 7) {
      rulesSidebar.classList.add('collapsed');
      this.isRulesSidebarOpen = false;
      const toggleText = document.getElementById('sidebar-toggle-text');
      if (toggleText) toggleText.textContent = 'Show Rules Sidebar';
    }

    // Update Stepper UI
    for (let i = 1; i <= this.totalSteps; i++) {
      const node = document.getElementById(`step-node-${i}`);
      const pane = document.getElementById(`step-pane-${i}`);
      const isApplicable = this.isStepApplicable(i);

      if (node) {
        node.classList.remove('active', 'ready');
        if (!isApplicable) {
          node.classList.add('skipped');
        } else {
          node.classList.remove('skipped');
          if (i < this.currentStep) {
            node.classList.add('completed');
          } else {
            node.classList.remove('completed');
          }
          if (i === this.currentStep) {
            node.classList.add('active');
            if (this.isCurrentStepReady(i)) {
              node.classList.add('ready');
            }
          }
        }
      }
      if (pane) {
        pane.classList.toggle('active', i === this.currentStep);
      }
    }

    // Step 4 overlay toggle
    const step4Overlay = document.getElementById('step-4-skipped-overlay');
    const step4Content = document.getElementById('step-4-content');
    if (step4Overlay && step4Content) {
      const isSheetApplicable = this.isStepApplicable(4);
      step4Overlay.classList.toggle('d-none', isSheetApplicable);
      step4Content.classList.toggle('d-none', !isSheetApplicable);
    }

    // Activate specific step views
    if (this.currentStep === 4) {
      this.populateSheetSelectionUI();
    } else if (this.currentStep === 5) {
      if (!this.rawHeaders || this.rawHeaders.length === 0) {
        this.applyOffsetAndRenderPreview();
      } else {
        this.renderOffsetPreviewGrid();
      }
    } else if (this.currentStep === 6) {
      this.renderColumnMappingUI();
    } else if (this.currentStep === 7) {
      // Regenerate normalized dataset so changes in Step 5 (offset) or Step 6 (column mappings/transforms) reflect immediately!
      this.generateNormalizedDataset();
      this.renderInteractiveGrid();
    } else if (this.currentStep === 8) {
      if (!this.normalizedData) {
        this.generateNormalizedDataset();
      }
      this.renderExportSummary();
    }

    document.getElementById('status-step-indicator').textContent = `Step ${this.currentStep} of ${this.totalSteps}`;
    const mainContent = document.querySelector('.app-main-content');
    if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
  }

  nextStep() {
    this.jumpToStep(this.currentStep + 1, 1);
  }

  prevStep() {
    this.jumpToStep(this.currentStep - 1, -1);
  }

  // =========================================================================
  // 4. STEP 3: FILE INGESTION & FORMAT MISMATCH GUARD
  // =========================================================================

  async handleFileUpload(file) {
    if (!file) return;

    this.uploadedFile = file;
    const fileName = file.name.toLowerCase();
    let actualType = 'unknown';

    if (fileName.endsWith('.csv')) actualType = 'csv';
    else if (fileName.endsWith('.tsv') || fileName.endsWith('.txt')) actualType = 'tsv';
    else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) actualType = 'xlsx';
    this.uploadedFileType = actualType;

    // Check mismatch with selected profile
    const expectedType = this.currentLayout ? this.currentLayout.fileType.toLowerCase() : null;
    const isMismatch = expectedType && (
      (expectedType === 'csv' && actualType === 'xlsx') ||
      (expectedType === 'xlsx' && (actualType === 'csv' || actualType === 'tsv'))
    );

    if (isMismatch) {
      const { isConfirmed } = await Swal.fire({
        title: '⚠️ Format Mismatch Warning',
        html: `
          <p class="small text-muted mb-2">The selected profile <strong>"${this.currentLayout.name}"</strong> expects a <strong>.${expectedType.toUpperCase()}</strong> file,</p>
          <p class="small text-muted mb-3">but you provided <strong>"${file.name}" (.${actualType.toUpperCase()})</strong>.</p>
          <div class="alert alert-warning small p-2 mb-0">Unravel can parse this file, but column layouts and sheet strategies may differ.</div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Proceed Anyway',
        cancelButtonText: 'Choose Different File',
        confirmButtonColor: '#005eb8'
      });

      if (!isConfirmed) {
        document.getElementById('source-file-input').value = '';
        return;
      }
    }

    Swal.fire({
      title: 'Reading Source File...',
      text: file.name,
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      if (actualType === 'csv' || actualType === 'tsv') {
        await this.parseDelimitedFile(file);
      } else if (actualType === 'xlsx') {
        await this.parseExcelFile(file);
      } else {
        throw new Error('Unsupported file extension. Please upload .xlsx, .csv, or .tsv');
      }

      Swal.close();
      this.showToast(`Successfully parsed "${file.name}"`);
      document.getElementById('uploaded-file-name').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      document.getElementById('file-drop-success').classList.remove('d-none');
      this.updateStepperReadyState();
      
      // Auto-cruise pipeline: advance to the furthest stage that can succeed without human intervention!
      this.autoCruisePipeline();

    } catch (err) {
      Swal.close();
      console.error(err);

      if (actualType === 'xlsx') {
        this.promptExcelPasswordOrService(file, err.message);
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Parsing Failed',
          text: err.message,
          confirmButtonColor: '#005eb8'
        });
      }
    }
  }

  /**
   * Auto-cruise: Attempt to advance to the furthest stage without human input.
   * If sheet strategy matches, headers are detected cleanly, and required mappings match,
   * it cruises straight to the Validation Grid (Step 7) or Offset (Step 5)!
   */
  autoCruisePipeline() {
    // 1. Worksheet resolution
    if (this.uploadedFileType === 'xlsx') {
      this.populateSheetSelectionUI();
      // If there is a strategy mismatch or no sheet matched, pause at Step 4 (no automatic fallback!)
      if (!this.sheetMatchStatus || !this.sheetMatchStatus.isMatch || !this.activeSheetName) {
        this.jumpToStep(4, 1);
        this.showToast("Paused at Step 4: Worksheet strategy mismatch. Please select a worksheet.");
        return;
      }
    } else {
      this.activeSheetName = Object.keys(this.rawWorksheets)[0];
    }

    if (!this.activeSheetName) {
      this.jumpToStep(4, 1);
      return;
    }

    // 2. Header Offset Auto-detection
    this.applyOffsetAndRenderPreview();
    if (!this.rawHeaders || this.rawHeaders.length === 0) {
      // Stop at Step 5 so user can adjust offset
      this.jumpToStep(5, 1);
      this.showToast("Paused at Step 5: Adjust table header offset.");
      return;
    }

    // 3. Column Translation Auto-mapping
    this.renderColumnMappingUI();
    const targetCols = this.projectConfig.targetColumns || [];
    const requiredCols = targetCols.filter(c => c.required);
    const mappedTargets = this.columnMappings
      .filter(m => m.sourceColumn && m.sourceColumn.trim().length > 0)
      .map(m => m.targetColumn);
    const unmappedRequired = requiredCols.filter(c => !mappedTargets.includes(c.key));

    if (unmappedRequired.length === 0) {
      // Clean mapping match: Cruise all the way to Step 7 (Validation Grid)!
      this.jumpToStep(7, 1);
      this.showToast("⚡ Auto-Cruise: Layout matched! Advanced straight to Validation Grid.");
    } else {
      // Missing some required columns: pause at Step 6
      this.jumpToStep(6, 1);
      this.showToast("Paused at Step 6: Map all required columns to continue.");
    }
  }

  async parseDelimitedFile(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: false,
        complete: (results) => {
          if (results.errors && results.errors.length > 0 && results.data.length === 0) {
            return reject(new Error(results.errors[0].message));
          }
          this.rawWorksheets = {
            "Delimited Sheet": results.data
          };
          this.activeSheetName = "Delimited Sheet";
          resolve();
        },
        error: (err) => reject(err)
      });
    });
  }

  async parseExcelFile(file, optionalBinaryData = null) {
    let data = optionalBinaryData;
    if (!data) {
      data = await file.arrayBuffer();
    }

    try {
      const workbook = XLSX.read(data, { type: 'array' });
      this.rawWorksheets = {};

      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const rawJsonMatrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        this.rawWorksheets[sheetName] = rawJsonMatrix;
      });

      if (workbook.SheetNames.length > 0) {
        this.activeSheetName = workbook.SheetNames[0];
      }
    } catch (e) {
      throw e;
    }
  }

  async promptExcelPasswordOrService(file, errorMsg) {
    if (!this.isDecryptionServiceEnabled()) {
      Swal.fire({
        icon: 'warning',
        title: 'Decryption Service Disabled',
        text: 'This spreadsheet is password-protected or encrypted, but Unravel Decryption Service is disabled in config.json.',
        confirmButtonColor: '#158cba'
      });
      return;
    }

    const { value: formValues } = await Swal.fire({
      title: '🔐 Encrypted Excel Workbook',
      html: `
        <p class="text-muted small">
          This spreadsheet appears to be password-protected or encrypted.
        </p>
        <div class="mb-3 text-start">
          <label class="form-label small fw-bold">Workbook Password</label>
          <input id="swal-xlsx-password" type="password" class="form-control" placeholder="Enter password (e.g. secret2026 or unravel2026)">
        </div>
        <div class="text-start mb-2">
          <label class="form-label small fw-bold">FastAPI Decryption Endpoint</label>
          <input id="swal-decrypt-url" type="text" class="form-control font-monospace small" value="${this.decryptionEndpoint}">
          <small class="text-secondary">Client dispatches payload to Python FastAPI decryption service running on port 8001.</small>
        </div>
        <div class="alert alert-warning py-1 px-2 small mt-2 mb-0 text-start" style="font-size:0.75rem;">
          <i class="bi bi-cloud-arrow-up text-warning me-1"></i>
          <strong>Cloud / Network Notice:</strong> The Decryption Service transmits this encrypted workbook to the endpoint above (which may reside in the cloud). <strong>This service is entirely optional</strong> — standard files never use this service.
        </div>
      `,
      confirmButtonText: 'Decrypt & Ingest',
      confirmButtonColor: '#005eb8',
      showCancelButton: true,
      preConfirm: () => {
        return {
          password: document.getElementById('swal-xlsx-password').value,
          endpoint: document.getElementById('swal-decrypt-url').value
        };
      }
    });

    if (!formValues || !formValues.password) return;

    Swal.fire({
      title: 'Connecting to Decryptor Service...',
      text: 'Transmitting payload over secure transit to FastAPI service...',
      didOpen: () => Swal.showLoading()
    });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64File = this.arrayBufferToBase64(arrayBuffer);
      let decryptedBytes;

      const isHybrid = formValues.endpoint.includes('-hybrid');
      if (isHybrid && window.UnravelSecurity && typeof window.UnravelSecurity.encryptPayloadHybrid === 'function') {
        // 1. Fetch server RSA public key
        const baseUrl = formValues.endpoint.replace(/\/api\/decrypt-xlsx.*$/, '');
        const pubKeyUrl = `${baseUrl}/api/public-key`;
        const pubKeyResp = await fetch(pubKeyUrl);
        if (!pubKeyResp.ok) throw new Error("Could not retrieve server RSA public key for hybrid transit encryption");
        const pubKeyData = await pubKeyResp.json();

        // 2. Hybrid encrypt payload with ephemeral AES-256-GCM wrapped in RSA-OAEP
        const hybridEnc = await window.UnravelSecurity.encryptPayloadHybrid(
          { fileData: base64File, password: formValues.password },
          pubKeyData.publicKey
        );

        // 3. Dispatch encrypted envelope
        const resp = await fetch(formValues.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            encryptedKey: hybridEnc.encryptedKey,
            encryptedPayload: hybridEnc.encryptedPayload,
            iv: hybridEnc.iv
          })
        });

        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson.detail || `HTTP ${resp.status} Hybrid decryption error`);
        }

        const resData = await resp.json();

        // 4. Decrypt response using ephemeral in-memory AES key
        const decryptedPayload = await window.UnravelSecurity.decryptPayloadHybrid(
          resData.encryptedPayload,
          resData.iv,
          hybridEnc.aesKey
        );
        decryptedBytes = this.base64ToArrayBuffer(decryptedPayload.fileData);
      } else {
        // Standard transport-layer TLS endpoint
        const resp = await fetch(formValues.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileData: base64File,
            password: formValues.password
          })
        });

        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson.detail || `HTTP ${resp.status} Decryption service error`);
        }

        const resData = await resp.json();
        decryptedBytes = this.base64ToArrayBuffer(resData.fileData);
      }

      await this.parseExcelFile(file, decryptedBytes);

      Swal.fire({
        icon: 'success',
        title: 'Workbook Decrypted!',
        text: 'Proceeding to worksheet selection.',
        timer: 1500,
        showConfirmButton: false
      });

      this.autoCruisePipeline();

    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Decryption Failed',
        html: `<p class="small text-danger">${err.message}</p>
               <p class="small text-muted">Ensure the FastAPI decryption microservice is running on port 8001.</p>`,
        confirmButtonColor: '#005eb8'
      });
    }
  }

  // =========================================================================
  // 5. STEP 4: WORKSHEET SELECTION
  // =========================================================================

  selectWorksheetByBadge(sheetName) {
    if (!sheetName || !this.rawWorksheets || !this.rawWorksheets[sheetName]) return;

    // 1. Set the "Preset Sheet Name" value as requested
    const presetInput = document.getElementById('sheet-preset-name');
    if (presetInput) presetInput.value = sheetName;

    // 2. Switch strategy mode to preset
    const modeEl = document.getElementById('sheet-strategy-mode');
    if (modeEl) {
      modeEl.value = 'preset';
      this.handleSheetStrategyModeChange();
    }

    // 3. Mark selected sheet active
    this.activeSheetName = sheetName;
    this.sheetMatchStatus = {
      isMatch: true,
      strategyMode: 'preset',
      reason: `Worksheet "${sheetName}" selected via badge.`,
      matchedSheet: sheetName,
      matchedSheets: [sheetName]
    };

    if (this.currentLayout && this.currentLayout.sheetStrategy) {
      this.currentLayout.sheetStrategy.mode = 'preset';
      this.currentLayout.sheetStrategy.presetName = sheetName;
    }

    const select = document.getElementById('sheet-dropdown');
    if (select) select.value = sheetName;

    const infoEl = document.getElementById('sheet-strategy-match-info');
    if (infoEl) {
      infoEl.innerHTML = `
        <span class="badge bg-success-subtle text-success border border-success-subtle">
          <i class="bi bi-check-circle-fill me-1"></i> Active Sheet: "${sheetName}"
        </span>
      `;
    }

    // 4. Update badges & preview table
    this.renderSheetBadges([sheetName]);
    this.renderSheetPreviewTable();
    this.updateStepperReadyState();
    this.updateDirtyState(true);
  }

  populateSheetSelectionUI() {
    if (!this.rawWorksheets) return;
    const sheetNames = Object.keys(this.rawWorksheets);

    const sheetCountBadge = document.getElementById('sheet-count-badge');
    if (sheetCountBadge) {
      sheetCountBadge.textContent = `${sheetNames.length} Sheet${sheetNames.length === 1 ? '' : 's'}`;
    }

    const select = document.getElementById('sheet-dropdown');
    if (select) {
      select.innerHTML = '';
      sheetNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `${name} (${(this.rawWorksheets[name] || []).length} rows)`;
        select.appendChild(opt);
      });
    }

    const modeEl = document.getElementById('sheet-strategy-mode');
    const strategyMode = modeEl ? modeEl.value : 'first_sheet';
    let matchedSheets = [];
    let autoMatchedDateInfo = null;
    let isMatch = false;
    let matchReason = '';

    if (strategyMode === 'first_sheet' && sheetNames.length > 0) {
      matchedSheets = [sheetNames[0]];
      isMatch = true;
      matchReason = `Primary worksheet in workbook ("${sheetNames[0]}") selected by default.`;
    } else if (strategyMode === 'preset') {
      const presetInput = document.getElementById('sheet-preset-name');
      const preset = (presetInput ? presetInput.value : '').trim();
      if (preset) {
        matchedSheets = sheetNames.filter(s => s.toLowerCase() === preset.toLowerCase());
        if (matchedSheets.length > 0) {
          isMatch = true;
          matchReason = `Exact match for preset name "${preset}".`;
        } else {
          isMatch = false;
          matchReason = `No worksheet found matching preset name "${preset}".`;
        }
      } else {
        isMatch = false;
        matchReason = 'Preset worksheet name is empty. Please enter a name or click a badge below.';
      }
    } else if (strategyMode === 'regex') {
      const regexInput = document.getElementById('sheet-regex-pattern');
      const pattern = (regexInput ? regexInput.value : '').trim();
      if (pattern) {
        try {
          const re = new RegExp(pattern, 'i');
          matchedSheets = sheetNames.filter(s => re.test(s));
          if (matchedSheets.length > 0) {
            isMatch = true;
            matchReason = `Worksheet(s) matched regular expression /${pattern}/i (${matchedSheets.length} found).`;
          } else {
            isMatch = false;
            matchReason = `No worksheet matched regular expression /${pattern}/i.`;
          }
        } catch (e) {
          isMatch = false;
          matchReason = `Invalid regular expression pattern: ${e.message}`;
        }
      } else {
        isMatch = false;
        matchReason = 'Regular expression pattern is empty.';
      }
    } else if (strategyMode === 'date_parse') {
      const dateFormatInput = document.getElementById('sheet-date-pattern');
      const targetFormat = (dateFormatInput && dateFormatInput.value.trim()) || 
        (this.currentLayout && this.currentLayout.sheetStrategy && this.currentLayout.sheetStrategy.dateFormatString) || 
        'YYYY-MM-DD';

      let latestTimestamp = -Infinity;
      let latestSheetName = null;
      let latestFormattedDate = null;

      sheetNames.forEach(sheetName => {
        let parsedDate = null;
        const dateLib = window.dayjs || window.moment;

        if (dateLib) {
          try {
            const d1 = dateLib(sheetName.trim(), targetFormat, true);
            if (d1 && d1.isValid()) parsedDate = d1;
          } catch (e) {}

          if (!parsedDate) {
            try {
              const d2 = dateLib(sheetName.trim(), targetFormat);
              if (d2 && d2.isValid()) parsedDate = d2;
            } catch (e) {}
          }

          if (!parsedDate) {
            const isoMatch = sheetName.match(/\b\d{4}[-_/]\d{1,2}[-_/]\d{1,2}\b/);
            const dmyMatch = sheetName.match(/\b\d{1,2}[-_/]\d{1,2}[-_/]\d{4}\b/);
            const compactMatch = sheetName.match(/\b(20\d{6}|19\d{6})\b/);
            const monthYearMatch = sheetName.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[-_\s]?\d{4}\b/i);

            const candidateStr = (isoMatch && isoMatch[0]) || 
                                 (dmyMatch && dmyMatch[0]) || 
                                 (compactMatch && compactMatch[0]) || 
                                 (monthYearMatch && monthYearMatch[0]);

            if (candidateStr) {
              const candidateFormats = [
                targetFormat,
                'YYYY-MM-DD', 'YYYY_MM_DD', 'YYYY/MM/DD',
                'DD-MM-YYYY', 'DD_MM_YYYY', 'DD/MM/YYYY',
                'MM-DD-YYYY', 'MM_DD_YYYY', 'MM/DD/YYYY',
                'YYYYMMDD',
                'MMMM YYYY', 'MMM YYYY', 'MMMM-YYYY', 'MMM-YYYY'
              ];
              for (const fmt of candidateFormats) {
                try {
                  const d3 = dateLib(candidateStr, fmt);
                  if (d3 && d3.isValid()) {
                    parsedDate = d3;
                    break;
                  }
                } catch (e) {}
              }
            }
          }
        } else {
          const t = Date.parse(sheetName);
          if (!isNaN(t)) {
            parsedDate = { valueOf: () => t, format: () => new Date(t).toISOString().slice(0, 10) };
          }
        }

        if (parsedDate && typeof parsedDate.valueOf === 'function') {
          const ts = parsedDate.valueOf();
          if (ts > latestTimestamp) {
            latestTimestamp = ts;
            latestSheetName = sheetName;
            latestFormattedDate = typeof parsedDate.format === 'function' ? parsedDate.format(targetFormat || 'YYYY-MM-DD') : new Date(ts).toISOString().slice(0, 10);
          }
        }
      });

      if (latestSheetName) {
        matchedSheets = [latestSheetName];
        autoMatchedDateInfo = latestFormattedDate;
        isMatch = true;
        matchReason = `Auto-identified latest worksheet by parsed date (${autoMatchedDateInfo}).`;
      } else {
        isMatch = false;
        matchReason = `No worksheet title contained dates matching format "${targetFormat}".`;
      }
    }

    if (isMatch && matchedSheets.length > 0) {
      // Pick first match by default codewise only
      this.activeSheetName = matchedSheets[0];
      if (select) select.value = matchedSheets[0];
      this.sheetMatchStatus = {
        isMatch: true,
        strategyMode: strategyMode,
        reason: matchReason,
        matchedSheet: matchedSheets[0],
        matchedSheets: matchedSheets
      };

      const dateInfoBadge = autoMatchedDateInfo ? ` <span class="badge bg-light text-dark ms-1">Latest Date: ${autoMatchedDateInfo}</span>` : '';
      const matchCountBadge = matchedSheets.length > 1 ? ` <span class="badge bg-light text-dark ms-1">${matchedSheets.length} matching</span>` : '';
      const infoEl = document.getElementById('sheet-strategy-match-info');
      if (infoEl) {
        infoEl.innerHTML = `
          <span class="badge bg-success-subtle text-success border border-success-subtle">
            <i class="bi bi-check-circle-fill me-1"></i> Active Sheet: "${this.activeSheetName}"
          </span>${matchCountBadge}${dateInfoBadge}
        `;
      }
    } else {
      // In worksheet mismatch: NO automatic fallback! Stop and wait for user selection.
      this.activeSheetName = null;
      if (select) select.value = '';
      this.sheetMatchStatus = {
        isMatch: false,
        strategyMode: strategyMode,
        reason: matchReason,
        matchedSheet: null,
        matchedSheets: []
      };

      const infoEl = document.getElementById('sheet-strategy-match-info');
      if (infoEl) {
        infoEl.innerHTML = `
          <span class="badge bg-danger-subtle text-danger border border-danger-subtle">
            <i class="bi bi-exclamation-triangle-fill me-1"></i> Strategy Mismatch: No sheet matched
          </span>
        `;
      }
    }

    this.renderSheetBadges(matchedSheets);
    this.renderSheetPreviewTable();
    this.updateStepperReadyState();
  }

  renderSheetBadges(matchedSheets = []) {
    const container = document.getElementById('sheet-badges-container');
    if (!container || !this.rawWorksheets) return;

    const sheetNames = Object.keys(this.rawWorksheets);
    if (sheetNames.length === 0) {
      container.innerHTML = '<span class="text-muted small fst-italic">No worksheets found.</span>';
      return;
    }

    const escape = (s) => (s === undefined || s === null ? '' : String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));

    container.innerHTML = '';
    sheetNames.forEach(name => {
      const rowCount = (this.rawWorksheets[name] || []).length;
      const isMatched = matchedSheets.includes(name);
      const isActive = (name === this.activeSheetName);

      let badgeClass = 'sheet-badge-unmatched';
      let iconClass = 'bi-file-earmark-spreadsheet text-muted';
      let countBadgeClass = 'bg-secondary-subtle text-secondary';

      if (isActive) {
        badgeClass = 'sheet-badge-active';
        iconClass = 'bi-check-circle-fill text-white';
        countBadgeClass = 'bg-light text-dark';
      } else if (isMatched) {
        badgeClass = 'sheet-badge-matched';
        iconClass = 'bi-check2 text-success';
        countBadgeClass = 'bg-success text-white';
      }

      const badgeBtn = document.createElement('button');
      badgeBtn.type = 'button';
      badgeBtn.className = `sheet-badge ${badgeClass}`;
      if (!badgeBtn.dataset) badgeBtn.dataset = {};
      badgeBtn.dataset.sheetName = name;
      badgeBtn.title = `Click to select "${name}" as preset worksheet`;
      badgeBtn.innerHTML = `
        <i class="bi ${iconClass} me-1"></i>
        <strong class="me-1">${escape(name)}</strong>
        <span class="badge ${countBadgeClass}" style="font-size:0.68rem;">${rowCount} rows</span>
      `;
      badgeBtn.addEventListener('click', () => {
        this.selectWorksheetByBadge(name);
      });

      container.appendChild(badgeBtn);
    });
  }

  handleSheetStrategyModeChange() {
    const isDelimited = (this.uploadedFileType && ['csv', 'tsv', 'txt'].includes(this.uploadedFileType.toLowerCase())) ||
      (this.currentLayout && ['csv', 'tsv', 'txt'].includes((this.currentLayout.fileType || '').toLowerCase()));

    const modeEl = document.getElementById('sheet-strategy-mode');
    const presetInput = document.getElementById('sheet-preset-name');
    const regexInput = document.getElementById('sheet-regex-pattern');
    const dateInput = document.getElementById('sheet-date-pattern');

    if (modeEl) {
      modeEl.disabled = !!isDelimited;
      if (isDelimited) {
        modeEl.setAttribute('title', 'Sheet strategy is disabled for flat delimited files (.csv, .tsv)');
      } else {
        modeEl.removeAttribute('title');
      }
    }

    [presetInput, regexInput, dateInput].forEach(el => {
      if (el) {
        el.disabled = !!isDelimited;
        if (isDelimited) {
          el.setAttribute('title', 'Sheet strategy is disabled for flat delimited files (.csv, .tsv)');
        } else {
          el.removeAttribute('title');
        }
      }
    });

    const mode = modeEl ? modeEl.value : 'first_sheet';
    const presetGrp = document.getElementById('sheet-preset-group');
    const regexGrp = document.getElementById('sheet-regex-group');
    const dateGrp = document.getElementById('sheet-date-group');
    if (presetGrp) presetGrp.classList.toggle('d-none', mode !== 'preset');
    if (regexGrp) regexGrp.classList.toggle('d-none', mode !== 'regex');
    if (dateGrp) dateGrp.classList.toggle('d-none', mode !== 'date_parse');

    if (this.rawWorksheets && Object.keys(this.rawWorksheets).length > 0) {
      this.populateSheetSelectionUI();
    }
  }

  renderSheetPreviewTable() {
    const container = document.getElementById('sheet-quick-preview');
    if (!container) return;

    let statusBanner = '';
    if (this.sheetMatchStatus) {
      if (this.sheetMatchStatus.isMatch && this.activeSheetName) {
        statusBanner = `
          <div class="alert alert-success-subtle border-success-subtle py-2 px-3 small d-flex align-items-center gap-2 mb-2 text-success-emphasis">
            <i class="bi bi-check-circle-fill text-success fs-5"></i>
            <div>
              <strong>Strategy Match Verified:</strong> ${this.sheetMatchStatus.reason} Previewing worksheet <code>"${this.activeSheetName}"</code>.
            </div>
          </div>
        `;
      } else {
        statusBanner = `
          <div class="alert alert-warning-subtle border-warning-subtle py-2 px-3 small d-flex align-items-center gap-2 mb-2 text-dark">
            <i class="bi bi-exclamation-circle-fill text-warning fs-5"></i>
            <div>
              <strong>Worksheet Strategy Mismatch:</strong> ${this.sheetMatchStatus.reason}
              <div class="text-secondary mt-1">Please click a worksheet badge above to select it, or adjust your matching criteria.</div>
            </div>
          </div>
        `;
      }
    }

    if (!this.activeSheetName || !this.sheetMatchStatus || !this.sheetMatchStatus.isMatch) {
      container.innerHTML = statusBanner + '<div class="p-3 text-muted fst-italic">No worksheet selected. Click one of the worksheet badges above to preview records.</div>';
      return;
    }

    const rawData = (this.rawWorksheets && this.rawWorksheets[this.activeSheetName]) || [];
    if (rawData.length === 0) {
      container.innerHTML = statusBanner + '<div class="p-3 text-muted">Selected worksheet has no records.</div>';
      return;
    }

    const previewSlice = rawData.slice(0, 5);
    let html = statusBanner + '<div class="table-responsive"><table class="table table-sm table-bordered text-nowrap mb-0 font-monospace small" style="min-width: 600px;">';
    previewSlice.forEach((row, rIdx) => {
      html += `<tr><td class="bg-light text-muted fw-bold" style="width: 50px; min-width: 50px;">R${rIdx + 1}</td>`;
      const cols = Array.isArray(row) ? row.slice(0, 8) : Object.values(row).slice(0, 8);
      cols.forEach(val => {
        html += `<td style="min-width: 110px;">${val !== undefined && val !== null ? String(val) : ''}</td>`;
      });
      html += '</tr>';
    });
    html += '</table></div>';
    container.innerHTML = html;
  }

  // =========================================================================
  // 6. STEP 5: OFFSET X & Y & LIVE HEADER DETECTION
  // =========================================================================

  applyOffsetAndRenderPreview() {
    const rawData = this.rawWorksheets[this.activeSheetName] || [];
    if (rawData.length === 0) return;

    const autoDetect = document.getElementById('auto-detect-header').checked;

    if (autoDetect) {
      let detectedRow = 0;
      for (let i = 0; i < Math.min(rawData.length, 10); i++) {
        const row = rawData[i] || [];
        const nonBlank = row.filter(cell => cell !== null && cell !== undefined && String(cell).trim().length > 0);
        if (nonBlank.length >= 2) {
          detectedRow = i;
          break;
        }
      }
      this.offsetY = detectedRow;
      document.getElementById('offset-y').value = detectedRow;
    } else {
      this.offsetY = parseInt(document.getElementById('offset-y').value) || 0;
      this.offsetX = parseInt(document.getElementById('offset-x').value) || 0;
    }

    const headerRow = rawData[this.offsetY] || [];
    this.rawHeaders = (Array.isArray(headerRow) ? headerRow : Object.values(headerRow))
      .slice(this.offsetX)
      .map((col, idx) => {
        const str = col !== null && col !== undefined ? String(col).trim() : '';
        return str.length > 0 ? str : `Column_${idx + 1}`;
      });

    this.rawMatrix = rawData.slice(this.offsetY + 1).map(row => {
      const arr = Array.isArray(row) ? row : Object.values(row);
      return arr.slice(this.offsetX);
    });

    this.renderOffsetPreviewGrid();
    this.updateStepperReadyState();
  }

  renderOffsetPreviewGrid() {
    const container = document.getElementById('offset-live-preview');
    if (!container) return;

    if (this.rawHeaders.length === 0) {
      container.innerHTML = '<div class="p-3 text-muted">No headers detected at current offset.</div>';
      return;
    }

    let html = '<div class="table-responsive"><table class="table table-sm table-hover table-bordered text-nowrap mb-0 font-monospace small" style="min-width: 650px;">';
    html += '<thead><tr class="table-primary"><th style="width: 50px; min-width: 50px;">#</th>';
    
    this.rawHeaders.forEach((h) => {
      html += `<th style="min-width: 140px;"><i class="bi bi-layout-three-columns text-primary"></i> ${h}</th>`;
    });
    html += '</tr></thead><tbody>';

    const previewRows = this.rawMatrix.slice(0, 6);
    previewRows.forEach((row, rIdx) => {
      html += `<tr><td class="bg-light text-muted fw-bold" style="width: 50px; min-width: 50px;">${rIdx + 1}</td>`;
      this.rawHeaders.forEach((h, cIdx) => {
        const val = row[cIdx] !== undefined && row[cIdx] !== null ? String(row[cIdx]) : '';
        html += `<td style="min-width: 140px;">${val}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
    document.getElementById('detected-headers-count').textContent = `${this.rawHeaders.length} Columns`;
    document.getElementById('detected-rows-count').textContent = `${this.rawMatrix.length} Data Rows`;
  }

  // =========================================================================
  // 7. STEP 6: COLUMN TRANSLATION (SOURCE -> TARGET) & TRANSFORMS
  // =========================================================================

  renderColumnMappingUI() {
    const targetCols = this.projectConfig.targetColumns || [];
    const container = document.getElementById('mapping-cards-container');
    container.innerHTML = '<div id="mapping-validation-gate-status" class="mb-3"></div>';

    const existingMappings = (this.columnMappings && this.columnMappings.length > 0)
      ? this.columnMappings
      : ((this.currentLayout && this.currentLayout.mappings) ? this.currentLayout.mappings : []);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-responsive mb-3';

    let tableHtml = `
      <table class="table table-bordered align-middle bg-white shadow-xs rounded mb-0" style="min-width: 720px;">
        <thead class="table-light">
          <tr>
            <th style="width: 40px; text-align: center;">#</th>
            <th style="width: 38%; min-width: 250px;">1. Uploaded Source Column (Dropdown)</th>
            <th style="width: 80px; text-align: center;">Flow</th>
            <th style="width: 42%; min-width: 280px;">2. Canonical Target Attribute</th>
          </tr>
        </thead>
        <tbody>
    `;

    targetCols.forEach((target, idx) => {
      let mappedSource = '';
      const existing = existingMappings.find(m => m.targetColumn === target.key);
      if (existing && this.rawHeaders.includes(existing.sourceColumn)) {
        mappedSource = existing.sourceColumn;
      } else {
        mappedSource = this.findBestHeaderMatch(target.key, target.label, this.rawHeaders);
      }

      const defVal = (existing && existing.defaultValue !== undefined) ? existing.defaultValue : (target.defaultValue !== undefined ? target.defaultValue : '');
      const transformsList = existing?.transforms || (existing?.transform ? [existing.transform] : (target.transforms || (target.transform ? [target.transform] : ['TRIM'])));
      const transStr = Array.isArray(transformsList) 
        ? transformsList.map(t => typeof t === 'string' ? t.toUpperCase() : (t.type || '').toUpperCase()).join(' &rarr; ')
        : 'TRIM';

      const valRules = (target.defaultValidations || target.validations || []);
      const valBadge = valRules.length > 0
        ? valRules.map(v => `<span class="badge bg-primary-subtle text-primary border" style="font-size:0.68rem;">${typeof v === 'string' ? v : v.type}</span>`).join(' ')
        : '';

      const defBadge = (defVal !== undefined && defVal !== '')
        ? `<span class="badge bg-light text-dark border font-monospace" style="font-size:0.68rem;">Def: "${defVal}"</span>`
        : '';

      // Sample preview
      const colIdx = this.rawHeaders.indexOf(mappedSource);
      const samples = (colIdx !== -1 && this.rawMatrix) ? this.rawMatrix.slice(0, 2).map(r => r[colIdx]).filter(v => v !== null && v !== undefined && v !== '') : [];
      const sampleText = samples.length > 0 ? `Sample: ${samples.map(s => `"${s}"`).join(', ')}` : 'No preview data';

      tableHtml += `
        <tr id="mapping-row-${target.key}" class="mapping-table-row">
          <td class="text-center text-muted small fw-bold">${idx + 1}</td>
          <!-- Row 1: Source Column Dropdown & Sample Preview -->
          <td>
            <select class="form-select form-select-sm mapping-source-select fw-semibold mb-1" data-target-key="${target.key}">
              <option value="">-- Do Not Import / Skip --</option>
              ${this.rawHeaders.map(h => `<option value="${h}" ${h === mappedSource ? 'selected' : ''}>${h}</option>`).join('')}
            </select>
            <div class="text-muted small font-monospace sample-preview-text" id="sample-preview-${target.key}" style="font-size: 0.72rem;">
              ${sampleText}
            </div>
          </td>
          <!-- Row 2: Down / Right Arrow Indicator -->
          <td class="text-center">
            <div class="text-primary fs-5" id="mapping-arrow-${target.key}">
              <i class="bi bi-arrow-right"></i>
            </div>
            <span class="badge ${mappedSource ? 'bg-success-subtle text-success' : (target.required ? 'bg-danger-subtle text-danger' : 'bg-light text-muted border')}" id="mapping-status-badge-${target.key}" style="font-size: 0.65rem;">
              ${mappedSource ? 'Mapped' : (target.required ? 'Missing' : 'Optional')}
            </span>
          </td>
          <!-- Row 3: Target Column, Required Pill & Transforms -->
          <td>
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="fw-bold text-dark">${target.label}</span>
              <code class="text-muted small">${target.key}</code>
              <span class="badge ${target.required ? 'bg-primary' : 'bg-light text-secondary border'}">${target.required ? 'Required' : 'Optional'}</span>
            </div>
            <div class="d-flex flex-wrap gap-1 align-items-center">
              <span class="badge bg-secondary-subtle text-secondary border font-monospace" style="font-size:0.68rem;" title="Transformation Pipeline">
                <i class="bi bi-magic me-1"></i>${transStr}
              </span>
              ${defBadge}
              ${valBadge}
            </div>
          </td>
        </tr>
      `;
    });

    // Calculated Columns
    const calcs = this.projectConfig.calculatedColumns || this.projectConfig.calculated_columns || [];
    if (calcs.length > 0) {
      tableHtml += `
        <tr class="table-info bg-opacity-25">
          <td colspan="4" class="fw-bold small text-info text-uppercase py-1 px-3">
            <i class="bi bi-calculator me-1"></i> Virtual / Calculated Columns (Computed from Formulated Expressions)
          </td>
        </tr>
      `;

      calcs.forEach((calc, cIdx) => {
        tableHtml += `
          <tr class="table-light">
            <td class="text-center text-info small fw-bold">f(x)</td>
            <td>
              <div class="p-2 bg-white rounded border font-monospace small text-primary fw-bold text-truncate" title="${calc.expression}">
                ${calc.expression}
              </div>
              <small class="text-muted" style="font-size: 0.72rem;">Automatically computed from source tokens</small>
            </td>
            <td class="text-center">
              <div class="text-info fs-5"><i class="bi bi-arrow-right"></i></div>
              <span class="badge bg-info text-white" style="font-size: 0.65rem;">Virtual</span>
            </td>
            <td>
              <div class="d-flex align-items-center gap-2 mb-1">
                <span class="fw-bold text-dark">${calc.label || calc.key}</span>
                <code class="text-muted small">${calc.key}</code>
                <span class="badge bg-info-subtle text-info border">Type: ${(calc.type || 'float').toUpperCase()}</span>
              </div>
            </td>
          </tr>
        `;
      });
    }

    tableHtml += `</tbody></table>`;
    tableWrapper.innerHTML = tableHtml;
    container.appendChild(tableWrapper);

    container.querySelectorAll('.mapping-source-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const tKey = e.target.dataset.targetKey;
        const newSource = e.target.value;
        const colIdx = this.rawHeaders.indexOf(newSource);
        const samples = (colIdx !== -1 && this.rawMatrix) ? this.rawMatrix.slice(0, 2).map(r => r[colIdx]).filter(v => v !== null && v !== undefined && v !== '') : [];
        const previewEl = document.getElementById(`sample-preview-${tKey}`);
        if (previewEl) {
          previewEl.textContent = samples.length > 0 ? `Sample: ${samples.map(s => `"${s}"`).join(', ')}` : 'No preview data';
        }
        const statusBadge = document.getElementById(`mapping-status-badge-${tKey}`);
        const targetDef = (this.projectConfig.targetColumns || []).find(t => t.key === tKey);
        if (statusBadge) {
          if (newSource) {
            statusBadge.className = 'badge bg-success-subtle text-success';
            statusBadge.textContent = 'Mapped';
          } else if (targetDef && targetDef.required) {
            statusBadge.className = 'badge bg-danger-subtle text-danger';
            statusBadge.textContent = 'Missing';
          } else {
            statusBadge.className = 'badge bg-light text-muted border';
            statusBadge.textContent = 'Optional';
          }
        }
        this.syncCurrentMappingsFromUI();
      });
    });

    this.syncCurrentMappingsFromUI();
  }

  findBestHeaderMatch(targetKey, targetLabel, headers) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanKey = normalize(targetKey);
    const cleanLabel = normalize(targetLabel);

    for (const h of headers) {
      const cleanH = normalize(h);
      if (cleanH === cleanKey || cleanH === cleanLabel) return h;
      if (cleanH.includes(cleanKey) || cleanKey.includes(cleanH)) return h;
      if (cleanH.includes(cleanLabel) || cleanLabel.includes(cleanH)) return h;
    }
    return '';
  }

  syncCurrentMappingsFromUI() {
    const selects = document.querySelectorAll('.mapping-source-select');
    this.columnMappings = [];

    selects.forEach(sel => {
      const targetKey = sel.dataset.targetKey;
      const sourceCol = sel.value;

      const targetDef = (this.projectConfig.targetColumns || []).find(t => t.key === targetKey);
      const existing = (this.currentLayout && this.currentLayout.mappings)
        ? this.currentLayout.mappings.find(m => m.targetColumn === targetKey)
        : null;

      const transforms = existing?.transforms || (existing?.transform ? [existing.transform] : (targetDef?.transforms || (targetDef?.transform ? [targetDef.transform] : ['TRIM'])));
      const defVal = (existing && existing.defaultValue !== undefined)
        ? existing.defaultValue
        : (targetDef?.defaultValue !== undefined ? targetDef.defaultValue : '');
      const dateSrc = existing?.dateFormatSource || 'YYYY-MM-DD';
      const dateTgt = existing?.dateFormatTarget || 'YYYY-MM-DD';
      const validations = targetDef ? (targetDef.defaultValidations || targetDef.validations || []) : (existing?.validations || []);

      this.columnMappings.push({
        targetColumn: targetKey,
        targetLabel: targetDef ? targetDef.label : targetKey,
        sourceColumn: sourceCol,
        required: targetDef ? targetDef.required : false,
        transforms: transforms,
        dateFormatSource: dateSrc,
        dateFormatTarget: dateTgt,
        defaultValue: defVal,
        validations: validations
      });
    });

    // Invalidate cached normalized data so any change reflects in Step 7 immediately
    this.normalizedData = null;

    // Update real-time validation gate status
    const targetCols = this.projectConfig.targetColumns || [];
    const requiredCols = targetCols.filter(c => c.required);
    const mappedTargets = this.columnMappings
      .filter(m => m.sourceColumn && m.sourceColumn.trim().length > 0)
      .map(m => m.targetColumn);

    const missingRequired = requiredCols.filter(c => !mappedTargets.includes(c.key));
    const gateStatusEl = document.getElementById('mapping-validation-gate-status');

    if (gateStatusEl) {
      if (missingRequired.length > 0) {
        gateStatusEl.innerHTML = `
          <div class="alert alert-warning small d-flex align-items-center gap-2 mb-0 py-2">
            <i class="bi bi-exclamation-triangle-fill text-warning fs-5"></i>
            <div>
              <strong>Action Required:</strong> The following mandatory columns must be mapped before proceeding:
              <strong>${missingRequired.map(c => c.label).join(', ')}</strong>.
            </div>
          </div>
        `;
      } else {
        gateStatusEl.innerHTML = `
          <div class="alert alert-success small d-flex align-items-center gap-2 mb-0 py-2">
            <i class="bi bi-check-circle-fill text-success fs-5"></i>
            <div>
              <strong>Ready to Proceed:</strong> All required canonical attributes have been matched to source columns.
            </div>
          </div>
        `;
      }
    }

    this.updateDirtyState(true);
    this.updateStepperReadyState();
  }

  // =========================================================================
  // 8. STEP 7: NORMALIZATION & INTERACTIVE ERROR-EDITING GRID
  // =========================================================================

  applyCellTransform(val, transform, dateSrc, dateTgt) {
    if (val === undefined || val === null) return '';
    let str = String(val);

    switch (transform) {
      case 'TRIM':
        return str.trim();
      case 'UPPERCASE':
        return str.trim().toUpperCase();
      case 'LOWERCASE':
        return str.trim().toLowerCase();
      case 'CAPITALIZE':
        return str.trim().toLowerCase().replace(/(?:^|\s|\/|-)\w/g, c => c.toUpperCase());
      case 'DATE_FORMAT':
        if (window.dayjs && str.trim()) {
          try {
            let parsed;
            if (val instanceof Date) {
              parsed = dayjs(val);
            } else if (!isNaN(Number(str)) && Number(str) > 20000 && Number(str) < 60000 && (!dateSrc || dateSrc.toLowerCase() === 'auto' || dateSrc.toLowerCase() === 'serial')) {
              const epoch = new Date(1899, 11, 30);
              const ms = epoch.getTime() + Number(str) * 86400000;
              parsed = dayjs(new Date(ms));
            } else {
              parsed = dayjs(str.trim(), dateSrc || undefined);
            }
            if (parsed && parsed.isValid()) {
              return parsed.format(dateTgt || 'YYYY-MM-DD');
            }
          } catch (e) {
            console.warn("Date format error:", e);
          }
        }
        return str.trim();
      case 'NONE':
      default:
        return str;
    }
  }

  generateNormalizedDataset() {
    this.syncCurrentMappingsFromUI();
    this.normalizedData = [];
    this.excludedRows = [];
    this.gridErrors = {};
    this.historyStack = [];
    this.redoStack = [];
    this.selectedRowIds.clear();

    const activeMappings = this.columnMappings.filter(m => m.sourceColumn && m.sourceColumn.length > 0);
    const candidateRows = [];

    // Stage 1 & 2: Mapping, Transforms, and Calculated Columns
    this.rawMatrix.forEach((rawRow, rIdx) => {
      const normRow = { _id: rIdx };

      activeMappings.forEach(mapping => {
        const sourceColIdx = this.rawHeaders.indexOf(mapping.sourceColumn);
        let val = sourceColIdx !== -1 ? rawRow[sourceColIdx] : '';

        // Multiple transforms support with backwards compatibility
        const transforms = mapping.transforms && mapping.transforms.length > 0
          ? mapping.transforms
          : (mapping.transform && mapping.transform !== 'NONE'
              ? [{ type: mapping.transform, dateFormatSource: mapping.dateFormatSource, dateFormatTarget: mapping.dateFormatTarget }]
              : []);

        if (window.UnravelValidator && window.UnravelValidator.applyTransforms) {
          val = window.UnravelValidator.applyTransforms(val, transforms);
        } else {
          val = this.applyCellTransform(val, mapping.transform, mapping.dateFormatSource, mapping.dateFormatTarget);
        }

        normRow[mapping.targetColumn] = val;
      });

      // Calculated Columns evaluation
      const calculatedCols = (this.projectConfig && (this.projectConfig.calculatedColumns || this.projectConfig.calculated_columns)) || [];
      calculatedCols.forEach(calcCol => {
        const formula = calcCol.formula || calcCol.expression || '';
        if (formula && window.UnravelValidator && window.UnravelValidator.evaluateExpression) {
          try {
            normRow[calcCol.id] = window.UnravelValidator.evaluateExpression(formula, normRow);
          } catch (e) {
            console.warn(`Error evaluating calculated column ${calcCol.id}:`, e);
            normRow[calcCol.id] = '';
          }
        }
      });

      candidateRows.push(normRow);
    });

    // Stage 3: Ingestion Pre-Filtering (Row Filters)
    const rowFiltersConfig = this.projectConfig && (this.projectConfig.rowFilters || this.projectConfig.row_filters);
    if (rowFiltersConfig && ((rowFiltersConfig.rules && rowFiltersConfig.rules.length > 0) || (Array.isArray(rowFiltersConfig) && rowFiltersConfig.length > 0))) {
      if (window.UnravelValidator && window.UnravelValidator.applyRowFilters) {
        const filterResult = window.UnravelValidator.applyRowFilters(candidateRows, rowFiltersConfig);
        this.normalizedData = filterResult.cleanRows;
        this.excludedRows = filterResult.excludedRows;
      } else {
        this.normalizedData = candidateRows;
        this.excludedRows = [];
      }
    } else {
      this.normalizedData = candidateRows;
      this.excludedRows = [];
    }

    // Stage 4: Validation Rule Checks on Candidate Clean Rows
    this.normalizedData.forEach(row => {
      const rIdx = row._id;

      activeMappings.forEach(mapping => {
        const val = row[mapping.targetColumn];
        const valRes = window.UnravelValidator.validate(val, mapping.validations, mapping.required);
        if (!valRes.valid) {
          if (!this.gridErrors[rIdx]) this.gridErrors[rIdx] = {};
          this.gridErrors[rIdx][mapping.targetColumn] = {
            error: valRes.error,
            defaultValue: mapping.defaultValue !== undefined ? mapping.defaultValue : ''
          };
        }
      });
    });

    this.updateUndoRedoButtons();
    this.renderRulesSidebarContent();
  }

  renderInteractiveGrid() {
    const tableHead = document.getElementById('grid-header-row');
    const tableBody = document.getElementById('grid-body');
    if (!tableHead || !tableBody) return;

    const activeMappings = this.columnMappings.filter(m => m.sourceColumn && m.sourceColumn.length > 0);
    const calculatedCols = (this.projectConfig && (this.projectConfig.calculatedColumns || this.projectConfig.calculated_columns)) || [];
    
    tableHead.innerHTML = `
      <th style="width: 36px; min-width: 36px; text-align: center;">
        <input type="checkbox" id="grid-select-all" class="form-check-input" title="Select All Rows">
      </th>
      <th class="row-num-cell" style="width: 48px; min-width: 48px;">#</th>
      ${activeMappings.map(m => `
        <th style="min-width: 160px;">
          <div class="d-flex align-items-center justify-content-between">
            <span>${m.targetLabel}</span>
            <div class="d-flex gap-1">
              ${m.required ? '<span class="badge bg-danger-subtle text-danger border" style="font-size:0.65rem;">Required</span>' : '<span class="badge bg-secondary-subtle text-secondary border" style="font-size:0.65rem;">Optional</span>'}
              <small class="badge bg-light text-muted border">${(m.validations && m.validations.length > 0) ? (typeof m.validations[0] === 'string' ? m.validations[0] : m.validations[0].type) : 'None'}</small>
            </div>
          </div>
        </th>
      `).join('')}
      ${calculatedCols.map(c => `
        <th style="min-width: 160px; background-color: #f8f9fa;">
          <div class="d-flex align-items-center justify-content-between">
            <span class="text-primary"><i class="bi bi-calculator me-1"></i>${c.label || c.id}</span>
            <span class="badge bg-info-subtle text-info border" style="font-size:0.65rem;">Calculated</span>
          </div>
        </th>
      `).join('')}
    `;

    // Filter rows based on activeFilter
    let displayRows = this.normalizedData || [];
    if (this.activeFilter === 'errors') {
      displayRows = (this.normalizedData || []).filter(r => {
        const rowErr = this.gridErrors[r._id];
        return !!rowErr && Object.keys(rowErr).length > 0;
      });
    } else if (this.activeFilter === 'valid') {
      displayRows = (this.normalizedData || []).filter(r => {
        const rowErr = this.gridErrors[r._id];
        return !rowErr || Object.keys(rowErr).length === 0;
      });
    }

    tableBody.innerHTML = '';
    displayRows.forEach(row => {
      const rIdx = row._id;
      const rowErr = this.gridErrors[rIdx] || {};
      const hasBlockingError = Object.keys(rowErr).length > 0;
      const isSelected = this.selectedRowIds.has(rIdx);
      
      const tr = document.createElement('tr');
      if (hasBlockingError) tr.classList.add('row-has-error');
      if (isSelected) tr.classList.add('row-selected');

      let rowHtml = `
        <td style="text-align: center; width: 36px; min-width: 36px;">
          <input type="checkbox" class="form-check-input row-select-checkbox" data-row-id="${rIdx}" ${isSelected ? 'checked' : ''} title="Select row ${rIdx + 1}">
        </td>
        <td class="row-num-cell cursor-pointer" data-row-id="${rIdx}" title="Click to select row ${rIdx + 1}">${rIdx + 1}</td>
      `;

      activeMappings.forEach(mapping => {
        const fieldKey = mapping.targetColumn;
        let cellVal = row[fieldKey] !== undefined ? row[fieldKey] : '';
        const errorInfo = rowErr[fieldKey] || null;

        let cellClass = '';
        let tooltip = '';

        if (errorInfo) {
          cellClass = 'cell-error';
          tooltip = `title="⚠️ ${errorInfo.error}" data-bs-toggle="tooltip"`;
        }

        rowHtml += `
          <td contenteditable="true" 
              class="${cellClass}" 
              data-row-id="${rIdx}" 
              data-field-key="${fieldKey}"
              style="min-width: 160px;"
              ${tooltip}>
            ${cellVal}
          </td>
        `;
      });

      calculatedCols.forEach(c => {
        const calcVal = row[c.id] !== undefined ? row[c.id] : '';
        rowHtml += `
          <td class="text-muted bg-light" 
              data-row-id="${rIdx}" 
              data-field-key="${c.id}"
              style="min-width: 160px;"
              title="Calculated value from formula: ${c.formula || ''}">
            ${calcVal}
          </td>
        `;
      });

      tr.innerHTML = rowHtml;
      tableBody.appendChild(tr);
    });

    this.bindGridCellEvents();
    this.bindRowSelectionEvents();
    this.updateGridStatusBadges();
    this.renderRulesSidebarContent();
  }

  bindGridCellEvents() {
    const cells = document.querySelectorAll('#grid-body td[contenteditable="true"]');
    cells.forEach(cell => {
      let originalVal = cell.textContent.trim();

      cell.addEventListener('focus', () => {
        originalVal = cell.textContent.trim();
      });

      cell.addEventListener('blur', () => {
        const newVal = cell.textContent.trim();
        if (originalVal !== newVal) {
          const rIdx = parseInt(cell.dataset.rowId);
          const fieldKey = cell.dataset.fieldKey;
          this.applyCellEdit(rIdx, fieldKey, newVal, originalVal);
        }
      });

      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          cell.blur();
        }
      });
    });
  }

  bindRowSelectionEvents() {
    const masterCheck = document.getElementById('grid-select-all');
    if (masterCheck) {
      masterCheck.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const checkboxes = document.querySelectorAll('.row-select-checkbox');
        checkboxes.forEach(cb => {
          cb.checked = checked;
          const rIdx = parseInt(cb.dataset.rowId);
          if (checked) {
            this.selectedRowIds.add(rIdx);
          } else {
            this.selectedRowIds.delete(rIdx);
          }
        });
        this.updateSelectionToolbar();
        this.renderInteractiveGrid();
      });
    }

    const rowCheckboxes = document.querySelectorAll('.row-select-checkbox');
    rowCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        const rIdx = parseInt(e.target.dataset.rowId);
        if (e.target.checked) {
          this.selectedRowIds.add(rIdx);
        } else {
          this.selectedRowIds.delete(rIdx);
        }
        this.updateSelectionToolbar();
        this.renderInteractiveGrid();
      });
    });

    const rowNumCells = document.querySelectorAll('.row-num-cell');
    rowNumCells.forEach(cell => {
      cell.addEventListener('click', (e) => {
        const rIdx = parseInt(e.currentTarget.dataset.rowId);
        if (isNaN(rIdx)) return;
        if (this.selectedRowIds.has(rIdx)) {
          this.selectedRowIds.delete(rIdx);
        } else {
          this.selectedRowIds.add(rIdx);
        }
        this.updateSelectionToolbar();
        this.renderInteractiveGrid();
      });
    });
  }

  updateSelectionToolbar() {
    const count = this.selectedRowIds.size;
    const badge = document.getElementById('selected-rows-badge');
    const deleteBtn = document.getElementById('btn-delete-selected');
    const clearBtn = document.getElementById('btn-clear-selection');
    const countEl = document.getElementById('selected-rows-count');
    const copyBtnText = document.getElementById('btn-copy-excel-text');

    if (countEl) countEl.textContent = count;
    if (badge) badge.classList.toggle('d-none', count === 0);
    if (deleteBtn) deleteBtn.classList.toggle('d-none', count === 0);
    if (clearBtn) clearBtn.classList.toggle('d-none', count === 0);

    if (copyBtnText) {
      copyBtnText.textContent = count > 0 ? `Copy ${count} for Excel` : 'Copy for Excel';
    }
  }

  copyRowsForExcel() {
    const activeMappings = (this.columnMappings || []).filter(m => m.sourceColumn && m.sourceColumn.length > 0);
    const calculatedCols = (this.projectConfig && (this.projectConfig.calculatedColumns || this.projectConfig.calculated_columns)) || [];
    
    if (activeMappings.length === 0 && calculatedCols.length === 0) {
      this.showToast("No mapped or calculated columns to copy");
      return;
    }

    const exportCols = [
      ...activeMappings.map(m => ({ key: m.targetColumn, label: m.targetLabel || m.targetColumn })),
      ...calculatedCols.map(c => ({ key: c.id, label: c.label || c.id }))
    ];

    let rowsToCopy = [];
    if (this.selectedRowIds && this.selectedRowIds.size > 0) {
      rowsToCopy = (this.normalizedData || []).filter(r => this.selectedRowIds.has(r._id));
    } else {
      // If no specific rows selected, copy currently displayed/filtered rows
      if (this.activeFilter === 'errors') {
        rowsToCopy = (this.normalizedData || []).filter(r => {
          const rowErr = this.gridErrors ? this.gridErrors[r._id] : null;
          return !!rowErr && Object.keys(rowErr).length > 0;
        });
      } else if (this.activeFilter === 'valid') {
        rowsToCopy = (this.normalizedData || []).filter(r => {
          const rowErr = this.gridErrors ? this.gridErrors[r._id] : null;
          return !rowErr || Object.keys(rowErr).length === 0;
        });
      } else {
        rowsToCopy = this.normalizedData || [];
      }
    }

    if (rowsToCopy.length === 0) {
      this.showToast("No records available to copy");
      return;
    }

    const escapeTsv = (val) => {
      if (val === undefined || val === null) return '';
      let str = String(val);
      if (str.includes('\t') || str.includes('\n') || str.includes('"') || str.includes('\r')) {
        str = '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // Header Line in TSV format
    const headerLine = exportCols.map(c => escapeTsv(c.label)).join('\t');

    // Data rows
    const dataLines = rowsToCopy.map(row => {
      return exportCols.map(c => {
        let val = row[c.key];
        return escapeTsv(val);
      }).join('\t');
    });

    const tsvContent = [headerLine, ...dataLines].join('\r\n');

    const onCopied = () => {
      const isSelectedOnly = this.selectedRowIds && this.selectedRowIds.size > 0;
      this.showToast(`📋 Copied ${rowsToCopy.length} ${isSelectedOnly ? 'selected ' : ''}row(s) formatted for Excel!`);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsvContent).then(onCopied).catch(() => {
        this.fallbackCopyText(tsvContent);
        onCopied();
      });
    } else {
      this.fallbackCopyText(tsvContent);
      onCopied();
    }
  }

  fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      console.warn("Fallback clipboard copy failed:", e);
    }
    document.body.removeChild(textarea);
  }

  clearSelection() {
    this.selectedRowIds.clear();
    this.updateSelectionToolbar();
    this.renderInteractiveGrid();
  }

  deleteSelectedRows() {
    const count = this.selectedRowIds.size;
    if (count === 0) return;

    Swal.fire({
      title: `Delete ${count} row(s)?`,
      text: "Deleted rows will be removed from the dataset. You can undo this action.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, Delete',
      confirmButtonColor: '#d5281b'
    }).then((res) => {
      if (res.isConfirmed) {
        const deletedRecords = [];
        this.selectedRowIds.forEach(id => {
          const idx = this.normalizedData.findIndex(r => r._id === id);
          if (idx !== -1) {
            deletedRecords.push({
              index: idx,
              row: this.normalizedData[idx],
              errors: this.gridErrors[id] ? { ...this.gridErrors[id] } : null
            });
          }
        });

        this.normalizedData = this.normalizedData.filter(r => !this.selectedRowIds.has(r._id));
        this.selectedRowIds.forEach(id => delete this.gridErrors[id]);

        this.historyStack.push({
          type: 'DELETE_ROWS',
          deleted: deletedRecords
        });
        this.redoStack = [];

        this.selectedRowIds.clear();
        this.updateSelectionToolbar();
        this.updateDirtyState(true);
        this.updateUndoRedoButtons();
        this.renderInteractiveGrid();
        this.showToast(`Deleted ${count} record(s)`);
      }
    });
  }

  applyCellEdit(rIdx, fieldKey, newVal, oldVal) {
    this.historyStack.push({
      type: 'EDIT_CELL',
      rowIndex: rIdx,
      field: fieldKey,
      oldValue: oldVal,
      newValue: newVal
    });
    this.redoStack = [];

    const row = this.normalizedData.find(r => r._id === rIdx);
    if (row) {
      row[fieldKey] = newVal;
      // Recalculate calculated columns for this row
      const calculatedCols = (this.projectConfig && (this.projectConfig.calculatedColumns || this.projectConfig.calculated_columns)) || [];
      calculatedCols.forEach(calcCol => {
        const formula = calcCol.formula || calcCol.expression || '';
        if (formula && window.UnravelValidator && window.UnravelValidator.evaluateExpression) {
          try {
            row[calcCol.id] = window.UnravelValidator.evaluateExpression(formula, row);
          } catch (e) {
            console.warn(`Error updating calculated column ${calcCol.id}:`, e);
          }
        }
      });
    }

    this.revalidateSingleCell(rIdx, fieldKey, newVal);
    this.updateDirtyState(true);
    this.updateUndoRedoButtons();
    this.renderInteractiveGrid();
  }

  revalidateSingleCell(rIdx, fieldKey, val) {
    const mapping = this.columnMappings.find(m => m.targetColumn === fieldKey);
    if (!mapping) return;

    const valRes = window.UnravelValidator.validate(val, mapping.validations, mapping.required);
    if (!valRes.valid) {
      if (!this.gridErrors[rIdx]) this.gridErrors[rIdx] = {};
      this.gridErrors[rIdx][fieldKey] = {
        error: valRes.error,
        defaultValue: mapping.defaultValue !== undefined ? mapping.defaultValue : ''
      };
    } else {
      if (this.gridErrors[rIdx]) {
        delete this.gridErrors[rIdx][fieldKey];
        if (Object.keys(this.gridErrors[rIdx]).length === 0) {
          delete this.gridErrors[rIdx];
        }
      }
    }
  }

  updateGridStatusBadges() {
    const totalRows = (this.normalizedData || []).length;
    let blockingErrors = 0;

    (this.normalizedData || []).forEach(r => {
      const rowErr = this.gridErrors[r._id];
      if (rowErr && Object.keys(rowErr).length > 0) {
        blockingErrors++;
      }
    });

    let validRows = totalRows - blockingErrors;

    const totalEl = document.getElementById('grid-total-count');
    const validEl = document.getElementById('grid-valid-count');
    const invalidEl = document.getElementById('grid-invalid-count');

    if (totalEl) totalEl.textContent = totalRows;
    if (validEl) validEl.textContent = validRows;
    if (invalidEl) invalidEl.textContent = blockingErrors;

    ['all', 'errors', 'valid'].forEach(filter => {
      const btn = document.getElementById(`filter-view-${filter}`);
      if (btn) {
        if (this.activeFilter === filter) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });
  }

  // =========================================================================
  // 9. BROWSER SIDEBAR (RULES & METRICS DRAWER)
  // =========================================================================

  toggleRulesSidebar() {
    this.isRulesSidebarOpen = !this.isRulesSidebarOpen;
    const sidebar = document.getElementById('rules-sidebar');
    const toggleText = document.getElementById('sidebar-toggle-text');

    if (sidebar) {
      sidebar.classList.toggle('collapsed', !this.isRulesSidebarOpen);
      if (toggleText) {
        toggleText.textContent = this.isRulesSidebarOpen ? 'Hide Rules Sidebar' : 'Show Rules Sidebar';
      }
      if (this.isRulesSidebarOpen) {
        this.renderRulesSidebarContent();
      }
    }
  }

  renderRulesSidebarContent() {
    const container = document.getElementById('rules-sidebar-content');
    if (!container) return;

    const activeMappings = this.columnMappings.filter(m => m.sourceColumn && m.sourceColumn.length > 0);
    const totalRows = this.normalizedData.length;

    let html = '';
    activeMappings.forEach(mapping => {
      let failedCount = 0;
      this.normalizedData.forEach(row => {
        if (this.gridErrors[row._id] && this.gridErrors[row._id][mapping.targetColumn]) {
          failedCount++;
        }
      });
      const passedCount = totalRows - failedCount;
      const passRate = totalRows > 0 ? ((passedCount / totalRows) * 100).toFixed(0) : 100;

      const rulesDesc = mapping.validations.map(v => typeof v === 'string' ? v : v.type).join(', ') || 'No rules';

      html += `
        <div class="rule-metric-card">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold text-dark small">${mapping.targetLabel}</span>
            <span class="badge ${mapping.required ? 'bg-danger-subtle text-danger' : 'bg-secondary-subtle text-secondary'}" style="font-size:0.65rem;">${mapping.required ? 'Required' : 'Optional'}</span>
          </div>
          <div class="text-muted small mb-2" style="font-size:0.75rem;">
            <code>${mapping.targetColumn}</code> ← <code>${mapping.sourceColumn}</code>
          </div>
          <div class="small text-secondary mb-1" style="font-size:0.75rem;">
            <strong>Transforms:</strong> <code>${(mapping.transforms && mapping.transforms.length > 0) ? mapping.transforms.map(t => typeof t === 'string' ? t : t.type).join(', ') : (mapping.transform || 'NONE')}</code>
          </div>
          <div class="small text-secondary mb-1" style="font-size:0.75rem;">
            <strong>Rules:</strong> ${rulesDesc}
          </div>
          <div class="small text-secondary mb-2" style="font-size:0.75rem;">
            <strong>Default:</strong> <code>"${mapping.defaultValue !== undefined ? mapping.defaultValue : ''}"</code>
          </div>
          <div class="d-flex justify-content-between align-items-center small">
            <span class="text-success"><i class="bi bi-check-circle"></i> ${passedCount} passed</span>
            <span class="${failedCount > 0 ? 'text-danger fw-bold' : 'text-muted'}">
              <i class="bi bi-x-circle"></i> ${failedCount} failed
            </span>
          </div>
          <div class="progress mt-2" style="height: 4px;">
            <div class="progress-bar ${passRate === '100' ? 'bg-success' : 'bg-danger'}" style="width: ${passRate}%"></div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  // =========================================================================
  // 10. UNDO / REDO & FIND & REPLACE ACTIONS
  // =========================================================================

  undo() {
    if (this.historyStack.length === 0) return;
    const action = this.historyStack.pop();
    this.redoStack.push(action);

    if (action.type === 'EDIT_CELL') {
      const row = this.normalizedData.find(r => r._id === action.rowIndex);
      if (row) {
        row[action.field] = action.oldValue;
        this.revalidateSingleCell(action.rowIndex, action.field, action.oldValue);
      }
    } else if (action.type === 'BULK_REPLACE') {
      action.previousStates.forEach(item => {
        const row = this.normalizedData.find(r => r._id === item.rowIndex);
        if (row) {
          row[item.field] = item.oldValue;
          this.revalidateSingleCell(item.rowIndex, item.field, item.oldValue);
        }
      });
    } else if (action.type === 'DELETE_ROWS') {
      action.deleted.forEach(item => {
        this.normalizedData.splice(item.index, 0, item.row);
        if (item.errors) {
          this.gridErrors[item.row._id] = item.errors;
        }
      });
    }

    this.renderInteractiveGrid();
    this.updateUndoRedoButtons();
    this.showToast("Action Undone");
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const action = this.redoStack.pop();
    this.historyStack.push(action);

    if (action.type === 'EDIT_CELL') {
      const row = this.normalizedData.find(r => r._id === action.rowIndex);
      if (row) {
        row[action.field] = action.newValue;
        this.revalidateSingleCell(action.rowIndex, action.field, action.newValue);
      }
    } else if (action.type === 'BULK_REPLACE') {
      action.previousStates.forEach(item => {
        const row = this.normalizedData.find(r => r._id === item.rowIndex);
        if (row) {
          row[item.field] = item.newValue;
          this.revalidateSingleCell(item.rowIndex, item.field, item.newValue);
        }
      });
    } else if (action.type === 'DELETE_ROWS') {
      const idsToDelete = new Set(action.deleted.map(d => d.row._id));
      this.normalizedData = this.normalizedData.filter(r => !idsToDelete.has(r._id));
      idsToDelete.forEach(id => delete this.gridErrors[id]);
    }

    this.renderInteractiveGrid();
    this.updateUndoRedoButtons();
    this.showToast("Action Redone");
  }

  updateUndoRedoButtons() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = this.historyStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }

  showFindReplaceModal() {
    const columns = this.columnMappings.filter(m => m.sourceColumn).map(m => `<option value="${m.targetColumn}">${m.targetLabel}</option>`).join('');

    Swal.fire({
      title: '🔍 Find & Replace',
      html: `
        <div class="text-start mb-3">
          <label class="form-label small fw-bold">Target Column</label>
          <select id="find-col-select" class="form-select form-select-sm">
            <option value="ALL">All Columns</option>
            ${columns}
          </select>
        </div>
        <div class="text-start mb-3">
          <label class="form-label small fw-bold">Find Value</label>
          <input id="find-text" type="text" class="form-control form-control-sm" placeholder="Text to search for">
        </div>
        <div class="text-start mb-2">
          <label class="form-label small fw-bold">Replace With</label>
          <input id="replace-text" type="text" class="form-control form-control-sm" placeholder="Replacement text">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Replace All Occurrences',
      confirmButtonColor: '#005eb8',
      preConfirm: () => {
        const col = document.getElementById('find-col-select').value;
        const findVal = document.getElementById('find-text').value;
        const replaceVal = document.getElementById('replace-text').value;
        if (!findVal) {
          Swal.showValidationMessage('Search value cannot be empty');
          return false;
        }
        return { col, findVal, replaceVal };
      }
    }).then((res) => {
      if (res.isConfirmed && res.value) {
        this.executeFindReplace(res.value.col, res.value.findVal, res.value.replaceVal);
      }
    });
  }

  executeFindReplace(col, findVal, replaceVal) {
    const previousStates = [];
    let count = 0;

    this.normalizedData.forEach(row => {
      const keysToSearch = col === 'ALL' 
        ? this.columnMappings.filter(m => m.sourceColumn).map(m => m.targetColumn)
        : [col];

      keysToSearch.forEach(key => {
        if (row[key] && String(row[key]).includes(findVal)) {
          const old = row[key];
          const replaced = String(row[key]).replaceAll(findVal, replaceVal);
          row[key] = replaced;
          previousStates.push({
            rowIndex: row._id,
            field: key,
            oldValue: old,
            newValue: replaced
          });
          this.revalidateSingleCell(row._id, key, replaced);
          count++;
        }
      });
    });

    if (count > 0) {
      this.historyStack.push({
        type: 'BULK_REPLACE',
        previousStates: previousStates
      });
      this.redoStack = [];
      this.updateDirtyState(true);
      this.updateUndoRedoButtons();
      this.renderInteractiveGrid();
      this.showToast(`Replaced ${count} occurrences`);
    } else {
      this.showToast("No matches found");
    }
  }

  // =========================================================================
  // 11. STEP 8: EXPORT SUMMARY & PRE-EXPORT CONFIRMATION
  // =========================================================================

  getExportMetrics() {
    if (!this.normalizedData) {
      this.generateNormalizedDataset();
    }
    const rawTotal = (this.rawMatrix && this.rawMatrix.length) ? this.rawMatrix.length : 0;
    const candidateTotal = (this.normalizedData && this.normalizedData.length) ? this.normalizedData.length : 0;
    const excludedCount = (this.excludedRows && this.excludedRows.length) ? this.excludedRows.length : 0;
    const total = rawTotal || (candidateTotal + excludedCount);

    let droppedCount = 0;
    if (this.normalizedData) {
      this.normalizedData.forEach(row => {
        const rowErr = (this.gridErrors && this.gridErrors[row._id]) ? this.gridErrors[row._id] : null;
        if (rowErr && Object.keys(rowErr).length > 0) {
          droppedCount++;
        }
      });
    }

    const readyCount = Math.max(0, candidateTotal - droppedCount);
    return { total, candidateTotal, readyCount, droppedCount, excludedCount };
  }

  renderExportSummary() {
    if (!this.normalizedData) {
      this.generateNormalizedDataset();
    }
    const { total, readyCount, droppedCount, excludedCount } = this.getExportMetrics();

    const elTotal = document.getElementById('export-total-records');
    const elClean = document.getElementById('export-clean-records');
    const elExcluded = document.getElementById('export-ignored-records');
    const elErrors = document.getElementById('export-error-records');

    if (elTotal) elTotal.textContent = total;
    if (elClean) elClean.textContent = readyCount;
    if (elExcluded) elExcluded.textContent = excludedCount;
    if (elErrors) elErrors.textContent = droppedCount;

    const warnBox = document.getElementById('export-error-warning');
    if (warnBox) {
      if (droppedCount > 0) {
        warnBox.className = 'alert alert-warning mb-4 shadow-sm';
        warnBox.innerHTML = `
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-exclamation-triangle-fill text-warning fs-4"></i>
            <div>
              <strong>Attention:</strong> <strong>${droppedCount} row(s)</strong> failed validation checks and will be omitted from the clean export.
              <strong>${readyCount} clean row(s)</strong> are ready for export.
            </div>
          </div>
        `;
      } else if (excludedCount > 0) {
        warnBox.className = 'alert alert-info mb-4 shadow-sm';
        warnBox.innerHTML = `
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-funnel-fill text-info fs-4"></i>
            <div>
              <strong>Ingestion Filtering Applied:</strong> <strong>${readyCount} row(s)</strong> passed all validation rules. 
              <strong>${excludedCount} row(s)</strong> were safely excluded by ingestion row filters.
            </div>
          </div>
        `;
      } else {
        warnBox.className = 'alert alert-success mb-4 shadow-sm';
        warnBox.innerHTML = `
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-check-circle-fill text-success fs-4"></i>
            <div>
              <strong>100% Sanitized:</strong> All <strong>${readyCount} row(s)</strong> passed every validation rule without error!
            </div>
          </div>
        `;
      }
    }
  }

  getSanitizedValidRows() {
    if (!this.normalizedData) {
      this.generateNormalizedDataset();
    }
    const validRows = [];
    if (!this.normalizedData) return validRows;

    this.normalizedData.forEach(row => {
      const rowErr = (this.gridErrors && this.gridErrors[row._id]) ? this.gridErrors[row._id] : null;
      if (rowErr && Object.keys(rowErr).length > 0) return;

      const cleanRow = { ...row };
      delete cleanRow._id;
      validRows.push(cleanRow);
    });

    return validRows;
  }

  async confirmAndExport(format) {
    const { total, readyCount, droppedCount, excludedCount } = this.getExportMetrics();

    let confirmHtml = `
      <p class="text-start small text-muted mb-2">You are about to export clean data in <strong>${format.toUpperCase()}</strong> format.</p>
      <div class="card p-3 bg-light text-start small mb-3">
        <div>Total Ingested Rows: <strong>${total}</strong></div>
        <div>Rows Ready for Export: <strong class="text-success">${readyCount}</strong></div>
        ${excludedCount > 0 ? `<div class="text-secondary">Rows Excluded by Ingestion Filters: <strong>${excludedCount}</strong></div>` : ''}
        ${droppedCount > 0 ? `<div class="text-danger fw-bold">⚠️ Dropped Rows with Validation Errors: <strong>${droppedCount}</strong></div>` : ''}
      </div>
    `;

    if (droppedCount > 0) {
      confirmHtml += `<p class="small text-danger fw-semibold mb-0">Notice: ${droppedCount} invalid row(s) will be dropped from the exported file.</p>`;
    }

    const { isConfirmed } = await Swal.fire({
      title: droppedCount > 0 ? `Export Data (${droppedCount} dropped)?` : 'Confirm Export',
      html: confirmHtml,
      icon: droppedCount > 0 ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: droppedCount > 0 ? `Drop ${droppedCount} & Export ${readyCount} Rows` : `Export ${readyCount} Rows`,
      confirmButtonColor: '#005eb8',
      cancelButtonText: 'Review Grid'
    });

    if (!isConfirmed) return;

    if (format === 'xlsx') {
      this.downloadCleanXlsx();
      this.recordSessionTelemetry();
    } else if (format === 'csv') {
      this.downloadCleanCsv();
      this.recordSessionTelemetry();
    } else if (format === 'api') {
      this.postToDestinationUrl();
    } else if (format === 'broker') {
      this.dispatchViaBroker();
    }
  }

  downloadCleanCsv() {
    const cleanRows = this.getSanitizedValidRows();
    if (cleanRows.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'No Clean Rows',
        text: 'There are no error-free rows available to download. Please resolve validation errors in the grid.',
        confirmButtonColor: '#158cba'
      });
      return;
    }
    const csv = Papa.unparse(cleanRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `unravel-clean-${Date.now()}.csv`;
    link.click();
    this.showToast(`Exported ${cleanRows.length} clean rows to CSV`);
  }

  downloadCleanXlsx() {
    const cleanRows = this.getSanitizedValidRows();
    if (cleanRows.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'No Clean Rows',
        text: 'There are no error-free rows available to download. Please resolve validation errors in the grid.',
        confirmButtonColor: '#158cba'
      });
      return;
    }
    const ws = XLSX.utils.json_to_sheet(cleanRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clean Data");
    XLSX.writeFile(wb, `unravel-clean-${Date.now()}.xlsx`);
    this.showToast(`Exported ${cleanRows.length} clean rows to XLSX`);
  }

  downloadExcludedCsv() {
    if (!this.excludedRows || this.excludedRows.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'No Excluded Rows',
        text: 'No rows were excluded by the configured ingestion row filters.',
        confirmButtonColor: '#158cba'
      });
      return;
    }

    const exportRows = this.excludedRows.map(row => {
      const { _id, _exclusion_reason, ...rest } = row;
      return {
        exclusion_reason: _exclusion_reason || 'Filtered out by ingestion rule',
        ...rest
      };
    });

    const csv = Papa.unparse(exportRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `unravel-excluded-${Date.now()}.csv`;
    link.click();
    this.showToast(`Exported ${exportRows.length} excluded rows with reasons to CSV`);
  }

  downloadCSV() {
    this.downloadCleanCsv();
  }

  downloadXLSX() {
    this.downloadCleanXlsx();
  }

  downloadJSON() {
    const cleanRows = this.getSanitizedValidRows();
    const jsonStr = JSON.stringify(cleanRows, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `unravel-clean-${Date.now()}.json`;
    link.click();
    this.showToast(`Exported ${cleanRows.length} valid rows to JSON`);
  }

  async postToDestinationUrl() {
    const destination = this.projectConfig.destination;
    const postUrl = destination ? destination.postUrl : null;

    if (!postUrl) {
      Swal.fire({
        icon: 'info',
        title: 'No Endpoint Configured',
        text: 'The active project schema does not specify a destination postUrl.',
        confirmButtonColor: '#158cba'
      });
      return;
    }

    const cleanRows = this.getSanitizedValidRows();

    Swal.fire({
      title: 'Transmitting Payload Directly...',
      text: `Posting ${cleanRows.length} records to ${postUrl}...`,
      didOpen: () => Swal.showLoading()
    });

    try {
      const headers = (destination && destination.headers) ? { ...destination.headers } : { 'Content-Type': 'application/json' };

      const resp = await fetch(postUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(cleanRows)
      });

      if (!resp.ok) {
        throw new Error(`Server responded with HTTP ${resp.status}`);
      }

      Swal.fire({
        icon: 'success',
        title: 'Transmission Succeeded',
        text: `${cleanRows.length} sanitized records posted successfully to ${postUrl}`,
        confirmButtonColor: '#158cba'
      });

      this.recordSessionTelemetry();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Transmission Failed',
        text: err.message,
        confirmButtonColor: '#158cba'
      });
    }
  }

  async dispatchViaBroker() {
    if (!this.isFileBrokerEnabled()) {
      Swal.fire({
        icon: 'warning',
        title: 'Unravel Broker Disabled',
        text: 'Unravel File Broker is disabled in config.json. Use Direct REST Dispatch instead.',
        confirmButtonColor: '#158cba'
      });
      return;
    }

    const destination = this.projectConfig.destination;
    const postUrl = destination ? destination.postUrl : null;

    if (!postUrl) {
      Swal.fire({
        icon: 'info',
        title: 'No Endpoint Configured',
        text: 'The active project schema does not specify a destination postUrl.',
        confirmButtonColor: '#158cba'
      });
      return;
    }

    const cleanRows = this.getSanitizedValidRows();
    const { total, readyCount, droppedCount } = this.getExportMetrics();

    Swal.fire({
      title: 'Dispatching via Unravel Broker...',
      text: 'Live forwarding clean records with delivery telemetry logging...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const brokerUrl = `${this.getUnravelServiceBaseUrl()}/api/broker/dispatch`;
    const headers = (destination && destination.headers) ? { ...destination.headers } : { 'Content-Type': 'application/json' };

    try {
      const resp = await fetch(brokerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationUrl: postUrl,
          headers: headers,
          payload: cleanRows,
          metadata: {
            user: this.author.email || this.author.username || 'System User',
            projectId: this.projectConfig.projectId || 'project',
            layoutId: this.currentLayout ? this.currentLayout.id : '',
            totalRows: readyCount,
            errorCount: droppedCount
          }
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || `Broker delivery failed with HTTP ${resp.status}`);
      }

      Swal.fire({
        icon: 'success',
        title: 'Delivered via Unravel Broker',
        html: `
          <p class="small text-muted mb-2">Successfully forwarded <strong>${cleanRows.length} records</strong> live to destination:</p>
          <div class="p-2 bg-light rounded border font-monospace small text-start mb-2">${postUrl}</div>
          <div class="small text-secondary">Latency: <strong>${data.durationMs}ms</strong> • Audit Delivery ID: <code>#${data.logId}</code></div>
        `,
        confirmButtonColor: '#158cba'
      });

      this.recordSessionTelemetry();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Broker Delivery Failed',
        text: err.message,
        confirmButtonColor: '#158cba'
      });
    }
  }

  async recordSessionTelemetry() {
    if (!this.isTelemetryEnabled()) return;
    const { total, readyCount, droppedCount } = this.getExportMetrics();
    const telemetryUrl = `${this.getUnravelServiceBaseUrl()}/api/telemetry/session`;

    const ruleErrors = {};
    Object.values(this.gridErrors || {}).forEach(rowErr => {
      Object.values(rowErr).forEach(err => {
        const ruleName = err.rule || 'UnknownRule';
        ruleErrors[ruleName] = (ruleErrors[ruleName] || 0) + 1;
      });
    });

    try {
      await fetch(telemetryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: this.author.email || this.author.username || 'user',
          projectId: this.projectConfig ? this.projectConfig.projectId : '',
          layoutId: this.currentLayout ? this.currentLayout.id : '',
          totalRows: total,
          validRows: readyCount,
          errorCount: droppedCount,
          ruleErrors: ruleErrors
        })
      });
    } catch (e) {
      // Telemetry error is silent / non-blocking
    }
  }

  // =========================================================================
  // 12. SAVE & EXPORT PROJECT CONFIG (.JSON)
  // =========================================================================

  computeLayoutChanges() {
    if (!this.currentLayout) return [];

    const changes = [];
    const orig = this.originalLayoutSnapshot || this.currentLayout;

    // 1. Offsets
    const curOffsetY = parseInt(document.getElementById('offset-y') ? document.getElementById('offset-y').value : this.offsetY) || 0;
    const curOffsetX = parseInt(document.getElementById('offset-x') ? document.getElementById('offset-x').value : this.offsetX) || 0;
    const curAuto = document.getElementById('auto-detect-header') ? document.getElementById('auto-detect-header').checked : true;

    const origOffsetY = (orig.offset && orig.offset.offsetY !== undefined) ? parseInt(orig.offset.offsetY) : 0;
    const origOffsetX = (orig.offset && orig.offset.offsetX !== undefined) ? parseInt(orig.offset.offsetX) : 0;
    const origAuto = (orig.offset && orig.offset.autoDetect !== undefined) ? !!orig.offset.autoDetect : true;

    if (curOffsetY !== origOffsetY) {
      changes.push(`Header Row Offset (Y): changed from <code>${origOffsetY}</code> to <strong><code>${curOffsetY}</code></strong>`);
    }
    if (curOffsetX !== origOffsetX) {
      changes.push(`Column Offset (X): changed from <code>${origOffsetX}</code> to <strong><code>${curOffsetX}</code></strong>`);
    }
    if (curAuto !== origAuto) {
      changes.push(`Auto-detect Header: changed from <code>${origAuto ? 'Enabled' : 'Disabled'}</code> to <strong><code>${curAuto ? 'Enabled' : 'Disabled'}</code></strong>`);
    }

    // 2. Sheet Strategy
    const sheetModeEl = document.getElementById('sheet-strategy-mode');
    const curSheetMode = sheetModeEl ? sheetModeEl.value : (orig.sheetStrategy ? orig.sheetStrategy.mode : 'first_sheet');
    const curPreset = document.getElementById('sheet-preset-name') ? document.getElementById('sheet-preset-name').value : '';
    const curRegex = document.getElementById('sheet-regex-pattern') ? document.getElementById('sheet-regex-pattern').value : '';
    const curDatePattern = document.getElementById('sheet-date-pattern') ? document.getElementById('sheet-date-pattern').value : 'YYYY-MM-DD';

    const origSheetMode = (orig.sheetStrategy && orig.sheetStrategy.mode) || 'first_sheet';
    const origPreset = (orig.sheetStrategy && orig.sheetStrategy.presetName) || '';
    const origRegex = (orig.sheetStrategy && orig.sheetStrategy.regexPattern) || '';
    const origDatePattern = (orig.sheetStrategy && orig.sheetStrategy.dateFormatString) || 'YYYY-MM-DD';

    if (curSheetMode !== origSheetMode) {
      changes.push(`Sheet Strategy Mode: changed from <code>${origSheetMode}</code> to <strong><code>${curSheetMode}</code></strong>`);
    }
    if (curSheetMode === 'preset' && curPreset !== origPreset) {
      changes.push(`Sheet Preset Name: changed to <strong><code>${curPreset}</code></strong>`);
    }
    if (curSheetMode === 'regex' && curRegex !== origRegex) {
      changes.push(`Sheet Regex Pattern: changed to <strong><code>${curRegex}</code></strong>`);
    }
    if (curSheetMode === 'date_parse' && curDatePattern !== origDatePattern) {
      changes.push(`Sheet Date Pattern: changed to <strong><code>${curDatePattern}</code></strong>`);
    }

    // 3. Mappings
    const origMappings = orig.mappings || [];
    this.columnMappings.forEach(m => {
      const origM = origMappings.find(om => om.targetColumn === m.targetColumn);
      const label = m.targetLabel || m.targetColumn;

      if (!origM) {
        if (m.sourceColumn) {
          changes.push(`Column <strong>${label}</strong>: newly mapped to <code>${m.sourceColumn}</code> (${m.transform || 'TRIM'})`);
        }
      } else {
        if ((origM.sourceColumn || '') !== (m.sourceColumn || '')) {
          changes.push(`Column <strong>${label}</strong>: source header changed from <code>${origM.sourceColumn || 'Unmapped'}</code> to <strong><code>${m.sourceColumn || 'Unmapped'}</code></strong>`);
        }
        if ((origM.transform || 'TRIM') !== (m.transform || 'TRIM')) {
          changes.push(`Column <strong>${label}</strong>: transform changed from <code>${origM.transform || 'TRIM'}</code> to <strong><code>${m.transform || 'TRIM'}</code></strong>`);
        }
        if (m.transform === 'DATE_FORMAT') {
          if ((origM.dateFormatSource || 'YYYY-MM-DD') !== (m.dateFormatSource || 'YYYY-MM-DD') ||
              (origM.dateFormatTarget || 'YYYY-MM-DD') !== (m.dateFormatTarget || 'YYYY-MM-DD')) {
            changes.push(`Column <strong>${label}</strong>: date format <code>${m.dateFormatSource || 'YYYY-MM-DD'}</code> → <strong><code>${m.dateFormatTarget || 'YYYY-MM-DD'}</code></strong>`);
          }
        }
        if ((origM.defaultValue || '') !== (m.defaultValue || '')) {
          changes.push(`Column <strong>${label}</strong>: default value changed from <code>'${origM.defaultValue || ''}'</code> to <strong><code>'${m.defaultValue || ''}'</code></strong>`);
        }
      }
    });

    // 4. Project Metadata (if modified)
    const metaName = document.getElementById('proj-meta-name');
    const metaId = document.getElementById('proj-meta-id');
    const metaVersion = document.getElementById('proj-meta-version');
    const metaUrl = document.getElementById('proj-meta-url');
    if (metaName && metaName.value && metaName.value !== this.projectConfig.name) {
      changes.push(`Project Name: updated to <strong>${metaName.value}</strong>`);
    }
    if (metaId && metaId.value && metaId.value !== this.projectConfig.projectId) {
      changes.push(`Project ID: updated to <strong><code>${metaId.value}</code></strong>`);
    }
    if (metaVersion && metaVersion.value && metaVersion.value !== this.projectConfig.version) {
      changes.push(`Project Version: updated to <strong>v${metaVersion.value}</strong>`);
    }
    const origUrl = (this.projectConfig.destination && this.projectConfig.destination.postUrl) || '';
    if (metaUrl && metaUrl.value && metaUrl.value !== origUrl) {
      changes.push(`API Destination URL: updated to <strong><code>${metaUrl.value}</code></strong>`);
    }
    const origAuth = (this.projectConfig.destination && this.projectConfig.destination.headers) ? (this.projectConfig.destination.headers.Authorization || '') : '';
    const metaToken = document.getElementById('proj-meta-token');
    const curToken = metaToken ? metaToken.value.trim() : '';
    if (curToken && curToken !== origAuth.replace(/^Bearer\s+/i, '')) {
      changes.push(`Authorization Token: updated in destination headers`);
    }

    return changes;
  }

  async saveProjectToDisk() {
    if (!this.projectConfig) {
      Swal.fire({ icon: 'warning', title: 'No Project Loaded', text: 'Please load a project schema first.', confirmButtonColor: '#005eb8' });
      return;
    }

    this.syncCurrentMappingsFromUI();

    if (!this.currentLayout && this.projectConfig.layouts && this.projectConfig.layouts.length > 0) {
      this.currentLayout = this.projectConfig.layouts[0];
    }

    // Sync any metadata edits from Step 1 inputs
    const metaName = document.getElementById('proj-meta-name');
    const metaId = document.getElementById('proj-meta-id');
    const metaVersion = document.getElementById('proj-meta-version');
    const metaUrl = document.getElementById('proj-meta-url');
    const tokenInput = document.getElementById('proj-meta-token');
    if (metaName && metaName.value) this.projectConfig.name = metaName.value.trim();
    if (metaId && metaId.value) this.projectConfig.projectId = metaId.value.trim();
    if (metaVersion && metaVersion.value) this.projectConfig.version = metaVersion.value.trim();
    if (metaUrl && metaUrl.value) {
      if (!this.projectConfig.destination) this.projectConfig.destination = {};
      this.projectConfig.destination.postUrl = metaUrl.value.trim();
    }
    if (tokenInput && tokenInput.value.trim()) {
      if (!this.projectConfig.destination) this.projectConfig.destination = {};
      if (!this.projectConfig.destination.headers) this.projectConfig.destination.headers = { "Content-Type": "application/json" };
      const raw = tokenInput.value.trim();
      this.projectConfig.destination.headers.Authorization = raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
    }

    const changes = this.computeLayoutChanges();
    const currentLayoutName = this.currentLayout ? this.currentLayout.name : 'Default Layout';
    const currentLayoutId = this.currentLayout ? this.currentLayout.id : 'layout_default';

    const allLayouts = this.projectConfig.layouts || [];
    const otherLayouts = allLayouts.filter(l => l.id !== currentLayoutId);
    const otherLayoutsOptions = otherLayouts.length > 0
      ? otherLayouts.map(l => `<option value="${l.id}">${l.name} (${l.id})</option>`).join('')
      : '<option value="" disabled>No other layouts available</option>';

    const suggestedNewId = `${currentLayoutId}_custom_${Math.floor(100 + Math.random() * 900)}`;
    const suggestedNewName = `${currentLayoutName} (Custom)`;

    const modalHtml = `
      <div class="text-start mb-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="small fw-bold text-dark"><i class="bi bi-list-check text-primary"></i> Modifications Summary</span>
          <span class="badge ${changes.length > 0 ? 'bg-primary' : 'bg-secondary'}">${changes.length} change(s)</span>
        </div>
        <div class="card p-2 bg-light border-0 small" style="max-height: 150px; overflow-y: auto;">
          ${changes.length > 0
            ? `<ul class="list-unstyled mb-0 d-flex flex-column gap-1">${changes.map(c => `<li class="d-flex align-items-start gap-1"><i class="bi bi-check-circle-fill text-success" style="font-size:0.75rem; margin-top:3px;"></i> <div>${c}</div></li>`).join('')}</ul>`
            : `<span class="text-muted fst-italic">No structural modifications detected from baseline snapshot.</span>`
          }
        </div>
      </div>

      <div class="text-start border-top pt-3">
        <label class="form-label small fw-bold text-dark mb-2">Select Provider Destination Action:</label>

        <!-- Option 1: Overwrite Current Provider -->
        <div class="form-check p-2 rounded mb-2 border hover-bg-light" style="cursor:pointer;" id="wrap-opt-current">
          <input class="form-check-input ms-0 me-2" type="radio" name="save-provider-action" id="save-opt-current" value="overwrite_current" checked>
          <label class="form-check-label fw-bold text-dark" for="save-opt-current" style="cursor:pointer;">
            Overwrite current provider: <span class="badge bg-primary text-wrap">${currentLayoutName}</span>
          </label>
          <div class="small text-muted ps-4">Updates the existing profile <code>${currentLayoutId}</code> with these modifications.</div>
        </div>

        <!-- Option 2: Overwrite a different existing provider -->
        <div class="form-check p-2 rounded mb-2 border hover-bg-light" style="cursor:pointer;" id="wrap-opt-other">
          <input class="form-check-input ms-0 me-2" type="radio" name="save-provider-action" id="save-opt-other" value="overwrite_other" ${otherLayouts.length === 0 ? 'disabled' : ''}>
          <label class="form-check-label fw-bold text-dark" for="save-opt-other" style="cursor:pointer;">
            Change provider being overwritten
          </label>
          <div class="small text-muted ps-4 mb-2">Select another existing provider profile to overwrite with these settings:</div>
          <div class="ps-4">
            <select id="save-select-other" class="form-select form-select-sm" ${otherLayouts.length === 0 ? 'disabled' : 'disabled'}>
              ${otherLayoutsOptions}
            </select>
          </div>
        </div>

        <!-- Option 3: Save as a new provider layout -->
        <div class="form-check p-2 rounded mb-1 border hover-bg-light" style="cursor:pointer;" id="wrap-opt-new">
          <input class="form-check-input ms-0 me-2" type="radio" name="save-provider-action" id="save-opt-new" value="save_new">
          <label class="form-check-label fw-bold text-dark" for="save-opt-new" style="cursor:pointer;">
            Save as a new provider layout
          </label>
          <div class="small text-muted ps-4 mb-2">Register a brand new provider layout alongside existing profiles:</div>
          <div id="save-new-fields" class="ps-4 d-none">
            <div class="row g-2">
              <div class="col-md-6">
                <label class="small fw-semibold text-secondary mb-1">New Layout ID:</label>
                <input type="text" id="save-new-id" class="form-control form-control-sm font-monospace" placeholder="e.g. layout_supplier_beta" value="${suggestedNewId}">
              </div>
              <div class="col-md-6">
                <label class="small fw-semibold text-secondary mb-1">Display Name:</label>
                <input type="text" id="save-new-name" class="form-control form-control-sm" placeholder="e.g. Supplier Beta (Custom)" value="${suggestedNewName}">
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const { value: formResult } = await Swal.fire({
      title: 'Save Provider Configuration',
      html: modalHtml,
      width: '620px',
      showCancelButton: true,
      confirmButtonText: '<i class="bi bi-floppy"></i> Confirm & Save',
      confirmButtonColor: '#005eb8',
      cancelButtonText: 'Cancel',
      didOpen: () => {
        const radCurrent = document.getElementById('save-opt-current');
        const radOther = document.getElementById('save-opt-other');
        const radNew = document.getElementById('save-opt-new');
        const selectOther = document.getElementById('save-select-other');
        const newFields = document.getElementById('save-new-fields');

        const updateVisibility = () => {
          if (radCurrent.checked) {
            selectOther.disabled = true;
            newFields.classList.add('d-none');
          } else if (radOther.checked) {
            selectOther.disabled = false;
            newFields.classList.add('d-none');
          } else if (radNew.checked) {
            selectOther.disabled = true;
            newFields.classList.remove('d-none');
          }
        };

        radCurrent.addEventListener('change', updateVisibility);
        radOther.addEventListener('change', updateVisibility);
        radNew.addEventListener('change', updateVisibility);

        document.getElementById('wrap-opt-current').addEventListener('click', (e) => {
          if (e.target.tagName !== 'INPUT') { radCurrent.checked = true; updateVisibility(); }
        });
        document.getElementById('wrap-opt-other').addEventListener('click', (e) => {
          if (otherLayouts.length > 0 && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
            radOther.checked = true; updateVisibility();
          }
        });
        document.getElementById('wrap-opt-new').addEventListener('click', (e) => {
          if (e.target.tagName !== 'INPUT') { radNew.checked = true; updateVisibility(); }
        });
      },
      preConfirm: () => {
        const radCurrent = document.getElementById('save-opt-current');
        const radOther = document.getElementById('save-opt-other');
        const radNew = document.getElementById('save-opt-new');

        if (radCurrent.checked) {
          return { action: 'overwrite_current', targetId: currentLayoutId };
        } else if (radOther.checked) {
          const selId = document.getElementById('save-select-other').value;
          if (!selId) {
            Swal.showValidationMessage('Please select an existing provider layout to overwrite.');
            return false;
          }
          return { action: 'overwrite_other', targetId: selId };
        } else if (radNew.checked) {
          const newId = document.getElementById('save-new-id').value.trim();
          const newName = document.getElementById('save-new-name').value.trim();
          if (!newId) {
            Swal.showValidationMessage('Please provide a layout ID for the new provider layout.');
            return false;
          }
          if (!newName) {
            Swal.showValidationMessage('Please provide a display name for the new provider layout.');
            return false;
          }
          return { action: 'save_new', newId, newName };
        }
        return false;
      }
    });

    if (!formResult) return;

    // Apply save
    const baseLayout = this.currentLayout || (this.projectConfig.layouts && this.projectConfig.layouts[0]) || {};
    let targetLayoutId = currentLayoutId;
    let targetLayoutName = currentLayoutName;

    if (formResult.action === 'overwrite_current') {
      targetLayoutId = currentLayoutId;
      targetLayoutName = currentLayoutName;
    } else if (formResult.action === 'overwrite_other') {
      targetLayoutId = formResult.targetId;
      const matched = this.projectConfig.layouts.find(l => l.id === targetLayoutId);
      targetLayoutName = matched ? matched.name : targetLayoutId;
    } else if (formResult.action === 'save_new') {
      targetLayoutId = formResult.newId;
      targetLayoutName = formResult.newName;
    }

    const updatedLayoutData = {
      id: targetLayoutId,
      name: targetLayoutName,
      fileType: this.uploadedFileType || (baseLayout ? baseLayout.fileType : 'xlsx'),
      filePassword: (baseLayout ? baseLayout.filePassword : '') || '',
      sheetStrategy: {
        mode: document.getElementById('sheet-strategy-mode') ? document.getElementById('sheet-strategy-mode').value : 'first_sheet',
        presetName: document.getElementById('sheet-preset-name') ? document.getElementById('sheet-preset-name').value : '',
        regexPattern: document.getElementById('sheet-regex-pattern') ? document.getElementById('sheet-regex-pattern').value : '',
        dateFormatString: document.getElementById('sheet-date-pattern') ? document.getElementById('sheet-date-pattern').value : 'YYYY-MM-DD'
      },
      offset: {
        offsetX: this.offsetX,
        offsetY: this.offsetY,
        autoDetect: document.getElementById('auto-detect-header') ? document.getElementById('auto-detect-header').checked : true,
        maxColumns: "Auto",
        maxRows: "Auto"
      },
      mappings: this.columnMappings.map(m => ({
        sourceColumn: m.sourceColumn,
        targetColumn: m.targetColumn,
        transforms: m.transforms || (m.transform ? [{ type: m.transform, dateFormatSource: m.dateFormatSource, dateFormatTarget: m.dateFormatTarget }] : []),
        transform: m.transform,
        dateFormatSource: m.dateFormatSource,
        dateFormatTarget: m.dateFormatTarget,
        defaultValue: m.defaultValue !== undefined ? m.defaultValue : '',
        validations: m.validations
      }))
    };

    if (formResult.action === 'save_new') {
      const existingIdx = this.projectConfig.layouts.findIndex(l => l.id === targetLayoutId);
      if (existingIdx !== -1) {
        this.projectConfig.layouts[existingIdx] = updatedLayoutData;
      } else {
        this.projectConfig.layouts.push(updatedLayoutData);
      }
    } else {
      const idx = this.projectConfig.layouts.findIndex(l => l.id === targetLayoutId);
      if (idx !== -1) {
        this.projectConfig.layouts[idx] = updatedLayoutData;
      } else {
        this.projectConfig.layouts.push(updatedLayoutData);
      }
    }

    this.currentLayout = updatedLayoutData;
    this.originalLayoutSnapshot = JSON.parse(JSON.stringify(updatedLayoutData));

    // Re-render UI
    this.renderLayoutSelector();
    this.selectLayout(targetLayoutId);
    this.updateDirtyState(false);

    // Save to localStorage & download file
    const jsonStr = JSON.stringify(this.projectConfig, null, 2);
    localStorage.setItem('unravel_active_project', jsonStr);

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `${this.projectConfig.projectId || 'project'}-config.json`;
    link.download = fileName;
    link.click();

    Swal.fire({
      icon: 'success',
      title: formResult.action === 'save_new' ? 'New Provider Layout Created!' : 'Provider Layout Overwritten!',
      html: `
        <p class="small text-muted mb-1">Layout <strong>${targetLayoutName}</strong> (<code>${targetLayoutId}</code>) successfully saved.</p>
        <p class="small text-muted mb-0">Project file <code>${fileName}</code> downloaded and cached in local vault.</p>
      `,
      confirmButtonColor: '#005eb8'
    });
  }

  updateDirtyState(dirty) {
    this.isDirty = dirty;
    const badge = document.getElementById('dirty-state-badge');
    const saveBtn = document.getElementById('menu-save-project');
    const quickSaveBtn = document.getElementById('');

    if (badge) {
      if (this.isDirty) {
        badge.className = 'dirty-indicator dirty';
        badge.innerHTML = '<i class="bi bi-circle-fill" style="font-size:0.5rem;"></i> Unsaved Changes';
      } else {
        badge.className = 'dirty-indicator clean';
        badge.innerHTML = '<i class="bi bi-check2"></i> Saved';
      }
    }

    if (saveBtn) saveBtn.classList.toggle('disabled', !this.isDirty);
    if (quickSaveBtn) quickSaveBtn.disabled = !this.isDirty;
  }

  setupWindowUnloadGuard() {
    window.addEventListener('beforeunload', (e) => {
      if (this.isDirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes in Unravel. Do you want to save your project definition before leaving?';
        return e.returnValue;
      }
    });
  }

  showPrivacyPolicyModal() {
    Swal.fire({
      title: '🛡️ Privacy & Zero-Trust Policy',
      width: '650px',
      html: `
        <div class="text-start small" style="line-height: 1.6; max-height: 380px; overflow-y: auto;">
          <div class="alert alert-info py-2 px-3 mb-3 d-flex align-items-center gap-2">
            <i class="bi bi-shield-lock-fill fs-5 text-primary"></i>
            <div><strong>Zero-Trust Guarantee:</strong> Your spreadsheets and records never leave this browser tab unless explicitly dispatched to your configured endpoint.</div>
          </div>
          
          <h6 class="fw-bold text-dark mb-1">1. 100% Client-Side In-Memory Execution</h6>
          <p class="text-muted mb-2">All parsing (XLSX, CSV, TSV), row transformations, data validation, and real-time inline cell editing are performed entirely in your browser's local RAM. No file contents, row records, or cells are ever transmitted to any third-party cloud or remote analytics platform.</p>

          <h6 class="fw-bold text-dark mb-1">2. Zero Telemetry & Zero Trackers</h6>
          <p class="text-muted mb-2">Unravel does not use tracking cookies, analytics services, telemetry pings, or fingerprinting scripts. All vendor dependencies (Bootstrap, SheetJS, PapaParse, Day.js, SweetAlert2) are bundled locally and run offline.</p>

          <h6 class="fw-bold text-dark mb-1">3. Web Crypto Vault Protection</h6>
          <p class="text-muted mb-2">When you configure a local master password, session definitions cached in your browser storage are encrypted using standard Web Crypto API AES-GCM 256-bit with PBKDF2 (100,000 iterations). Your keys stay in local browser session memory.</p>

          <h6 class="fw-bold text-dark mb-1">4. Explicit Destination Dispatch Only</h6>
          <p class="text-muted mb-2">Network transmission occurs solely when you explicitly click "Dispatch to REST API" in Step 8 (to your own configured URL), or when you opt to decrypt a password-protected spreadsheet via the optional decryption gateway.</p>

          <h6 class="fw-bold text-dark mb-1">5. Optional Cloud Decryption Service Notice</h6>
          <p class="text-muted mb-2">If you choose to use the <strong>Optional XLSX Decryption Service</strong> for password-protected Excel files, please note that this service transmits the encrypted workbook payload to your configured decryption endpoint (which may be hosted in the cloud or on a remote server). <strong>Using this decryption service is entirely optional.</strong> All standard, unencrypted spreadsheets (XLSX, CSV, TSV) run 100% inside your browser RAM without any cloud transit.</p>

          <h6 class="fw-bold text-dark mb-1">6. Enterprise Compliance Ready</h6>
          <p class="text-muted mb-0">Unravel's air-gapped architecture complies with GDPR, HIPAA, UK DPA, and enterprise zero-trust confidentiality mandates for PII, financial, and proprietary data.</p>
        </div>
      `,
      confirmButtonText: 'Understood',
      confirmButtonColor: '#005eb8'
    });
  }

  // =========================================================================
  // 13. UTILITIES & EVENT BINDING
  // =========================================================================

  bindEvents() {
    for (let i = 1; i <= this.totalSteps; i++) {
      const node = document.getElementById(`step-node-${i}`);
      if (node) {
        node.addEventListener('click', () => this.jumpToStep(i));
      }
    }

    document.querySelectorAll('[data-wizard-action="next"]').forEach(btn => {
      btn.addEventListener('click', () => this.nextStep());
    });
    document.querySelectorAll('[data-wizard-action="prev"]').forEach(btn => {
      btn.addEventListener('click', () => this.prevStep());
    });

    const editMetaBtn = document.getElementById('btn-toggle-edit-meta');
    if (editMetaBtn) {
      editMetaBtn.addEventListener('click', () => this.toggleEditMetadata());
    }

    const dropzone = document.getElementById('file-dropzone');
    const fileInput = document.getElementById('source-file-input');
    const chooseFileBtn = document.getElementById('btn-choose-file');

    if (chooseFileBtn && fileInput) {
      chooseFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });
    }

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', (e) => {
        // Prevent opening browse dialog when clicking sample buttons or custom button actions
        if (e.target.closest('#sample-files-container, #btn-load-sample-csv, #btn-load-sample-xlsx, #btn-load-sample-enc, #btn-choose-file')) {
          return;
        }
        fileInput.click();
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) this.handleFileUpload(e.target.files[0]);
      });

      ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer.files.length > 0) {
          this.handleFileUpload(e.dataTransfer.files[0]);
        }
      });
    }

    const sheetDropdown = document.getElementById('sheet-dropdown');
    if (sheetDropdown) {
      sheetDropdown.addEventListener('change', (e) => {
        this.activeSheetName = e.target.value;
        this.renderSheetPreviewTable();
      });
    }

    const sheetModeSelect = document.getElementById('sheet-strategy-mode');
    if (sheetModeSelect) {
      sheetModeSelect.addEventListener('change', () => this.handleSheetStrategyModeChange());
    }

    ['sheet-preset-name', 'sheet-regex-pattern', 'sheet-date-pattern'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          if (this.rawWorksheets && Object.keys(this.rawWorksheets).length > 0) {
            this.populateSheetSelectionUI();
          }
        });
      }
    });

    const manualDecryptBtn = document.getElementById('btn-manual-decrypt-stage');
    if (manualDecryptBtn) {
      manualDecryptBtn.addEventListener('click', () => {
        if (this.uploadedFile) {
          this.promptExcelPasswordOrService(this.uploadedFile, "Manual decryption requested");
        } else {
          this.showToast("Please upload an encrypted workbook in Step 3 first");
        }
      });
    }

    ['offset-y', 'offset-x', 'auto-detect-header'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this.applyOffsetAndRenderPreview());
    });

    // Step 1: URL schema loader & sample chips
    const fetchSchemaBtn = document.getElementById('btn-fetch-schema-url');
    if (fetchSchemaBtn) {
      fetchSchemaBtn.addEventListener('click', () => {
        const input = document.getElementById('input-schema-url');
        const url = input ? input.value.trim() : '';
        if (url) {
          this.fetchSchemaFromUrl(url);
        } else {
          this.showToast('Please enter a schema URL or file path');
        }
      });
    }

    const schemaUrlInput = document.getElementById('input-schema-url');
    if (schemaUrlInput) {
      schemaUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const url = schemaUrlInput.value.trim();
          if (url) this.fetchSchemaFromUrl(url);
        }
      });
    }

    document.querySelectorAll('.btn-sample-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const url = chip.dataset.url;
        const input = document.getElementById('input-schema-url');
        if (input) input.value = url;
        if (url) this.fetchSchemaFromUrl(url);
      });
    });

    const switchProjBtn = document.getElementById('btn-switch-project');
    if (switchProjBtn) {
      switchProjBtn.addEventListener('click', () => {
        this.showLoadProjectPanel();
      });
    }

    const step1CloseBtn = document.getElementById('btn-close-project');
    if (step1CloseBtn) {
      step1CloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.closeProject();
      });
    }

    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    const findBtn = document.getElementById('btn-find-replace');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
    if (findBtn) findBtn.addEventListener('click', () => this.showFindReplaceModal());

    ['all', 'errors', 'valid'].forEach(filter => {
      const btn = document.getElementById(`filter-view-${filter}`);
      if (btn) {
        btn.addEventListener('click', () => {
          this.activeFilter = filter;
          this.renderInteractiveGrid();
        });
      }
    });

    const deleteSelectedBtn = document.getElementById('btn-delete-selected');
    const clearSelectionBtn = document.getElementById('btn-clear-selection');
    const copyExcelBtn = document.getElementById('btn-copy-selected-excel');
    if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', () => this.deleteSelectedRows());
    if (clearSelectionBtn) clearSelectionBtn.addEventListener('click', () => this.clearSelection());
    if (copyExcelBtn) copyExcelBtn.addEventListener('click', () => this.copyRowsForExcel());

    const toggleSidebarBtn = document.getElementById('btn-toggle-rules-sidebar');
    const closeSidebarBtn = document.getElementById('btn-close-rules-sidebar');
    if (toggleSidebarBtn) toggleSidebarBtn.addEventListener('click', () => this.toggleRulesSidebar());
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => this.toggleRulesSidebar());

    const saveBtn = document.getElementById('menu-save-project');
    const quickSaveBtn = document.getElementById('btn-quick-save');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveProjectToDisk());
    if (quickSaveBtn) quickSaveBtn.addEventListener('click', () => this.saveProjectToDisk());

    const closeProjBtn = document.getElementById('menu-close-project');
    if (closeProjBtn) {
      closeProjBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.closeProject();
      });
    }

    // Hash change routing (/ #/url/... and /#/project/...)
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash || '';
      if (hash.startsWith('#/url/')) {
        const url = decodeURIComponent(hash.substring(6));
        this.fetchSchemaFromUrl(url, false);
      } else if (hash.startsWith('#/project/')) {
        const projectId = decodeURIComponent(hash.substring(10));
        this.fetchProjectFromUnravelService(projectId);
      }
    });

    // Sample File Loaders
    const sampleCsvBtn = document.getElementById('btn-load-sample-csv');
    if (sampleCsvBtn) {
      sampleCsvBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const resp = await fetch('assets/sample-data/sample-patients.csv');
          const blob = await resp.blob();
          const file = new File([blob], 'sample-patients.csv', { type: 'text/csv' });
          this.handleFileUpload(file);
        } catch (err) {
          this.showToast('Could not load sample CSV');
        }
      });
    }

    const sampleXlsxBtn = document.getElementById('btn-load-sample-xlsx');
    if (sampleXlsxBtn) {
      sampleXlsxBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const resp = await fetch('assets/sample-data/sample-patients.xlsx');
          const blob = await resp.blob();
          const file = new File([blob], 'sample-patients.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          this.handleFileUpload(file);
        } catch (err) {
          this.showToast('Could not load sample XLSX');
        }
      });
    }

    const sampleEncBtn = document.getElementById('btn-load-sample-enc');
    if (sampleEncBtn) {
      sampleEncBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const resp = await fetch('assets/sample-data/sample-encrypted.xlsx');
          const blob = await resp.blob();
          const file = new File([blob], 'sample-encrypted.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          this.handleFileUpload(file);
        } catch (err) {
          this.showToast('Could not load sample encrypted XLSX');
        }
      });
    }
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        this.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveProjectToDisk();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.showFindReplaceModal();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        const activeEl = document.activeElement;
        const isEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
        if (!isEditing && this.currentStep === 7 && this.selectedRowIds && this.selectedRowIds.size > 0) {
          e.preventDefault();
          this.copyRowsForExcel();
        }
      }
    });
  }

  showToast(message) {
    const Toast = Swal.mixin({
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 2500,
      timerProgressBar: true
    });
    Toast.fire({
      icon: 'info',
      title: message
    });
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

if (typeof window !== 'undefined') {
  window.UnravelApp = UnravelApp;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UnravelApp;
}

let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new UnravelApp();
  window.unravelApp = app;
  window.app = app;
});
