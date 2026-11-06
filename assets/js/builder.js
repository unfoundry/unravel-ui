/**
 * Unravel - Developer Config Studio Engine (builder.js)
 * Enables rapid visual authoring, scaffolding, and validation of customer project schemas.
 */

class UnravelBuilder {
  constructor() {
    this.starterTemplates = [];
    this.schema = this.getDefaultFallbackSchema();
    this.activeLayoutIndex = 0;
    this.detectedHeaders = []; // from uploaded sample file
    this.undoStack = [];
    this.redoStack = [];
    this._isHistoryAction = false;
    this.editingColIndex = null;
    this.jsonCollapsed = localStorage.getItem('unravel_builder_hide_json') === 'true';
    this.init();
  }

  getDefaultFallbackSchema() {
    return {
      projectId: "customer-records-v1",
      name: "Client & Customer Ingestion Profile",
      version: "1.0.0",
      author: {
        username: "dev.consultant",
        email: "consultant@enterprise.org"
      },
      destination: {
        postUrl: "https://api.enterprise.io/v1/ingest/records",
        headers: {
          "Authorization": "Bearer {{TOKEN}}",
          "Content-Type": "application/json"
        }
      },
      targetColumns: [
        {
          key: "client_id",
          label: "Client ID",
          required: true,
          defaultValue: "",
          defaultValidations: ["IsAlphanumeric"],
          transforms: ["TRIM"]
        },
        {
          key: "client_name",
          label: "Client Name",
          required: true,
          defaultValue: "",
          defaultValidations: [],
          transforms: ["CAPITALIZE"]
        },
        {
          key: "email",
          label: "Contact Email",
          required: true,
          defaultValue: "",
          defaultValidations: ["IsEmail"],
          transforms: ["LOWERCASE"]
        },
        {
          key: "phone_number",
          label: "Telephone",
          required: false,
          defaultValue: "N/A",
          defaultValidations: ["IsPhoneNumber"],
          transforms: ["TRIM"]
        },
        {
          key: "postal_code",
          label: "Postal Code",
          required: false,
          defaultValue: "UNKNOWN",
          defaultValidations: ["IsPostcode"],
          transforms: ["UPPERCASE"]
        },
        {
          key: "signup_date",
          label: "Registration Date",
          required: false,
          defaultValue: "",
          defaultValidations: [],
          transforms: [{ type: "CAST_DATE", dateFormatSource: "DD/MM/YYYY", dateFormatTarget: "YYYY-MM-DD" }]
        }
      ],
      calculatedColumns: [
        {
          key: "client_ref",
          label: "Client Reference Code",
          expression: "[client_id] + '-' + [postal_code]",
          type: "string",
          transforms: ["UPPERCASE"]
        }
      ],
      rowFilters: {
        combine: "AND",
        rules: []
      },
      layouts: [
        {
          id: "layout_partner_standard",
          name: "Standard Partner Spreadsheet (.xlsx)",
          fileType: "xlsx",
          filePassword: "",
          sheetStrategy: {
            mode: "first_sheet",
            presetName: "Clients",
            regexPattern: "^(Client|Customer|Data).*$",
            dateFormatString: "YYYY-MM-DD"
          },
          offset: {
            offsetX: 0,
            offsetY: 0,
            autoDetect: true,
            maxColumns: "Auto",
            maxRows: "Auto"
          },
          mappings: [
            { sourceColumn: "Account Number", targetColumn: "client_id", transform: "TRIM", defaultValue: "", validations: [{ type: "IsAlphanumeric" }] },
            { sourceColumn: "Customer Name", targetColumn: "client_name", transform: "CAPITALIZE", defaultValue: "", validations: [] },
            { sourceColumn: "Email Address", targetColumn: "email", transform: "LOWERCASE", defaultValue: "", validations: [{ type: "IsEmail" }] },
            { sourceColumn: "Contact Phone", targetColumn: "phone_number", transform: "TRIM", defaultValue: "N/A", validations: [{ type: "IsPhoneNumber" }] },
            { sourceColumn: "Postcode", targetColumn: "postal_code", transform: "UPPERCASE", defaultValue: "UNKNOWN", validations: [{ type: "IsPostcode" }] },
            { sourceColumn: "Join Date", targetColumn: "signup_date", transform: "DATE_FORMAT", dateFormatSource: "DD/MM/YYYY", dateFormatTarget: "YYYY-MM-DD", defaultValue: "", validations: [] }
          ]
        }
      ]
    };
  }

  async init() {
    this.cleanPathname();
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
      });
    }
    await this.loadAppConfig();
    await this.loadStarterTemplates();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.applyJsonCollapsedState();
    this.renderAll();
    this.pushHistory();
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
      // Ignored
    }
  }

  // =========================================================================
  // UNDO / REDO HISTORY ENGINE
  // =========================================================================

  pushHistory() {
    if (this._isHistoryAction) return;
    const snap = JSON.stringify(this.schema);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoRedoUI();
  }

  undo() {
    if (this.undoStack.length <= 1) return;
    this._isHistoryAction = true;
    const current = this.undoStack.pop();
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    this.schema = JSON.parse(prev);
    this.renderAll();
    this._isHistoryAction = false;
    this.updateUndoRedoUI();
    this.showToast('Undo');
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this._isHistoryAction = true;
    const next = this.redoStack.pop();
    this.undoStack.push(next);
    this.schema = JSON.parse(next);
    this.renderAll();
    this._isHistoryAction = false;
    this.updateUndoRedoUI();
    this.showToast('Redo');
  }

  updateUndoRedoUI() {
    const canUndo = this.undoStack.length > 1;
    const canRedo = this.redoStack.length > 0;
    const btnUndo = document.getElementById('btn-builder-undo');
    const btnRedo = document.getElementById('btn-builder-redo');
    const menuUndo = document.getElementById('menu-builder-undo');
    const menuRedo = document.getElementById('menu-builder-redo');

    if (btnUndo) btnUndo.disabled = !canUndo;
    if (btnRedo) btnRedo.disabled = !canRedo;
    if (menuUndo) menuUndo.classList.toggle('disabled', !canUndo);
    if (menuRedo) menuRedo.classList.toggle('disabled', !canRedo);
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't intercept inside modal textareas or when typing
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!e.shiftKey) {
          e.preventDefault();
          this.undo();
        } else {
          e.preventDefault();
          this.redo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.downloadSchema();
      }
    });
  }

  // =========================================================================
  // LIVE JSON PREVIEW COLLAPSE / EXPAND
  // =========================================================================

  toggleJsonPreview() {
    this.jsonCollapsed = !this.jsonCollapsed;
    localStorage.setItem('unravel_builder_hide_json', this.jsonCollapsed ? 'true' : 'false');
    this.applyJsonCollapsedState();
  }

  applyJsonCollapsedState() {
    const jsonCol = document.getElementById('builder-json-column');
    const leftCol = document.getElementById('builder-left-column');
    const btnLabel = document.getElementById('btn-toggle-json-label');
    const menuText = document.getElementById('menu-toggle-json-text');

    if (this.jsonCollapsed) {
      if (jsonCol) jsonCol.classList.add('d-none');
      if (leftCol) {
        leftCol.classList.remove('col-lg-7', 'col-xl-8');
        leftCol.classList.add('col-12');
      }
      if (btnLabel) btnLabel.textContent = 'Show JSON';
      if (menuText) menuText.textContent = 'Show JSON Live Preview';
    } else {
      if (jsonCol) jsonCol.classList.remove('d-none');
      if (leftCol) {
        leftCol.classList.remove('col-12');
        leftCol.classList.add('col-lg-7', 'col-xl-8');
      }
      if (btnLabel) btnLabel.textContent = 'Hide JSON';
      if (menuText) menuText.textContent = 'Hide JSON Live Preview';
    }
  }

  newSchema() {
    Swal.fire({
      title: 'New Schema?',
      text: 'This will reset the editor to a clean schema scaffold. Any unsaved edits will be lost.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, New Schema',
      confirmButtonColor: '#005eb8'
    }).then(res => {
      if (res.isConfirmed) {
        this.resetToCleanState();
      }
    });
  }

  resetToCleanState() {
    this.schema = this.getDefaultFallbackSchema();
    this.activeLayoutIndex = 0;
    this.renderAll();
    this.pushHistory();
    this.showToast('Schema reset to clean state');
  }

  async loadAppConfig() {
    try {
      const resp = await fetch('../config.json');
      if (resp.ok) {
        this.appConfig = await resp.json();
        this.applyAppConfig();
      }
    } catch (e) {
      console.info("config.json could not be fetched in builder:", e.message);
    }
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
      return `../${clean.replace(/^\/+/, '')}`;
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

    // 1. Document Title & Meta Description
    document.title = `${appName} Developer Studio - ${appSubtitle}`;

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

    // 2. Brand Logo & Favicon: Image takes precedence over Icon
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

    // 3. Theme CSS variables injection
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

    // 4. Feature: Enable/Disable Starter Templates & Sample Scaffolds
    const enableSamples = (this.appConfig.features && this.appConfig.features.enableSamples !== undefined)
      ? !!this.appConfig.features.enableSamples
      : true;

    const starterTemplatesPanel = document.getElementById('builder-starter-templates-panel');
    if (starterTemplatesPanel) {
      starterTemplatesPanel.classList.toggle('d-none', !enableSamples);
    }
  }

  // =========================================================================
  // STARTER TEMPLATES MANAGEMENT (Governed by starter-templates.json)
  // =========================================================================

  async loadStarterTemplates() {
    // Check localStorage for customized templates list first
    const cached = localStorage.getItem('unravel_starter_templates');
    if (cached) {
      try {
        this.starterTemplates = JSON.parse(cached);
        this.renderStarterTemplates();
        return;
      } catch (e) {
        console.warn("Invalid cached starter templates, fetching from disk", e);
      }
    }

    try {
      const resp = await fetch('../assets/sample-data/starter-templates.json');
      if (resp.ok) {
        this.starterTemplates = await resp.json();
      } else {
        throw new Error("HTTP " + resp.status);
      }
    } catch (e) {
      console.warn("Could not fetch starter-templates.json, using fallback templates", e);
      this.starterTemplates = [
        {
          id: "customer_crm",
          name: "Customer CRM",
          icon: "bi-people",
          description: "Customer ID, Name, Phone, Email",
          badge: "Commercial",
          enabled: true,
          schema: this.getDefaultFallbackSchema()
        }
      ];
    }
    this.renderStarterTemplates();
  }

  renderStarterTemplates() {
    const container = document.getElementById('builder-templates-container');
    const badgeCount = document.getElementById('templates-count-badge');
    if (!container) return;

    const visibleTemplates = this.starterTemplates.filter(t => t.enabled !== false);
    if (badgeCount) badgeCount.textContent = `${visibleTemplates.length} Active`;

    if (visibleTemplates.length === 0) {
      container.innerHTML = `
        <div class="col-12 text-center py-2 text-muted small bg-light rounded">
          No templates currently enabled. Click "Manage Templates" to enable templates.
        </div>
      `;
      return;
    }

    container.innerHTML = visibleTemplates.map(tmpl => `
      <div class="col-md-3">
        <div class="p-2 template-card bg-white" data-template-id="${tmpl.id}">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold small text-primary"><i class="bi ${tmpl.icon || 'bi-file-earmark-code'}"></i> ${tmpl.name}</span>
            <span class="badge bg-light text-muted border" style="font-size:0.65rem;">${tmpl.badge || 'Template'}</span>
          </div>
          <small class="text-muted d-block" style="font-size:0.75rem;">${tmpl.description || ''}</small>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-template-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.templateId;
        const matched = this.starterTemplates.find(t => t.id === id);
        if (matched && matched.schema) {
          this.schema = JSON.parse(JSON.stringify(matched.schema));
          this.activeLayoutIndex = 0;
          this.renderAll();
          this.showToast(`Loaded ${matched.name} template`);
        }
      });
    });
  }

  showManageTemplatesModal() {
    const modalHtml = `
      <div class="text-start small">
        <p class="text-muted mb-2">Enable or disable templates shown on the Dev Studio dashboard, or download the updated <code>starter-templates.json</code>.</p>
        <div class="list-group mb-3" style="max-height: 240px; overflow-y: auto;">
          ${this.starterTemplates.map((t, idx) => `
            <div class="list-group-item d-flex justify-content-between align-items-center p-2">
              <div>
                <i class="bi ${t.icon || 'bi-file-earmark'} text-primary me-1"></i>
                <strong>${t.name}</strong> <code>(${t.id})</code>
                <div class="text-muted small">${t.description || ''}</div>
              </div>
              <div class="form-check form-switch m-0">
                <input class="form-check-input template-enable-toggle" type="checkbox" id="tmpl-chk-${idx}" data-index="${idx}" ${t.enabled !== false ? 'checked' : ''}>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    Swal.fire({
      title: 'Manage Starter Templates',
      html: modalHtml,
      width: '600px',
      showCancelButton: true,
      confirmButtonText: 'Save & Update',
      confirmButtonColor: '#005eb8',
      cancelButtonText: 'Close',
      showDenyButton: true,
      denyButtonText: '<i class="bi bi-download"></i> Download templates.json',
      denyButtonColor: '#198754',
      didOpen: () => {
        document.querySelectorAll('.template-enable-toggle').forEach(chk => {
          chk.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index);
            this.starterTemplates[idx].enabled = e.target.checked;
          });
        });
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const jsonStr = JSON.stringify(this.starterTemplates, null, 2);
        localStorage.setItem('unravel_starter_templates', jsonStr);
        this.renderStarterTemplates();
        this.showToast('Starter templates updated!');
      } else if (result.isDenied) {
        const jsonStr = JSON.stringify(this.starterTemplates, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'starter-templates.json';
        a.click();
        this.showToast('Downloaded starter-templates.json');
      }
    });
  }

  async saveCurrentAsStarterTemplate() {
    const { value: formValues } = await Swal.fire({
      title: 'Save Schema as Starter Template',
      html: `
        <div class="text-start small">
          <div class="mb-2">
            <label class="form-label fw-bold mb-1">Template ID (slug):</label>
            <input id="swal-tmpl-id" class="form-control form-control-sm font-monospace" value="${(this.schema.projectId || 'custom').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}">
          </div>
          <div class="mb-2">
            <label class="form-label fw-bold mb-1">Display Name:</label>
            <input id="swal-tmpl-name" class="form-control form-control-sm" value="${this.schema.name || 'Custom Ingestion Template'}">
          </div>
          <div class="mb-2">
            <label class="form-label fw-bold mb-1">Icon (Bootstrap Icon class):</label>
            <input id="swal-tmpl-icon" class="form-control form-control-sm font-monospace" value="bi-file-earmark-medical" placeholder="e.g. bi-hospital, bi-people, bi-cash-stack">
          </div>
          <div class="mb-2">
            <label class="form-label fw-bold mb-1">Category Badge:</label>
            <input id="swal-tmpl-badge" class="form-control form-control-sm" value="Custom" placeholder="e.g. Healthcare, Commercial">
          </div>
          <div class="mb-2">
            <label class="form-label fw-bold mb-1">Short Description:</label>
            <input id="swal-tmpl-desc" class="form-control form-control-sm" value="${(this.schema.targetColumns || []).length} target columns and ${(this.schema.layouts || []).length} layouts">
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '<i class="bi bi-bookmark-plus"></i> Save Template',
      confirmButtonColor: '#005eb8',
      preConfirm: () => {
        const id = document.getElementById('swal-tmpl-id').value.trim();
        const name = document.getElementById('swal-tmpl-name').value.trim();
        if (!id) { Swal.showValidationMessage('Template ID is required'); return false; }
        if (!name) { Swal.showValidationMessage('Display Name is required'); return false; }
        return {
          id: id,
          name: name,
          icon: document.getElementById('swal-tmpl-icon').value.trim() || 'bi-file-earmark',
          badge: document.getElementById('swal-tmpl-badge').value.trim() || 'Custom',
          description: document.getElementById('swal-tmpl-desc').value.trim(),
          enabled: true,
          schema: JSON.parse(JSON.stringify(this.schema))
        };
      }
    });

    if (!formValues) return;

    // Check if ID already exists
    const existingIdx = this.starterTemplates.findIndex(t => t.id === formValues.id);
    if (existingIdx !== -1) {
      this.starterTemplates[existingIdx] = formValues;
    } else {
      this.starterTemplates.push(formValues);
    }

    localStorage.setItem('unravel_starter_templates', JSON.stringify(this.starterTemplates, null, 2));
    this.renderStarterTemplates();
    this.showToast(`Saved "${formValues.name}" as starter template!`);
  }

  // =========================================================================
  // EVENT BINDINGS
  // =========================================================================

  bindEvents() {
    // Template management buttons
    const manageTemplatesBtn = document.getElementById('btn-manage-templates');
    if (manageTemplatesBtn) manageTemplatesBtn.addEventListener('click', () => this.showManageTemplatesModal());

    const saveAsTemplateBtn = document.getElementById('btn-save-as-template');
    if (saveAsTemplateBtn) saveAsTemplateBtn.addEventListener('click', () => this.saveCurrentAsStarterTemplate());

    // File Drop Zone for Auto-Scaffold
    const dropZone = document.getElementById('builder-drop-zone');
    const fileInput = document.getElementById('builder-file-input');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-primary', 'bg-light'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-primary', 'bg-light'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-primary', 'bg-light');
        if (e.dataTransfer.files.length > 0) this.handleSampleFileUpload(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) this.handleSampleFileUpload(e.target.files[0]);
      });
    }

    // Import existing JSON button
    const importInput = document.getElementById('builder-import-json-input');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const parsed = JSON.parse(ev.target.result);
              this.schema = parsed;
              this.activeLayoutIndex = 0;
              this.renderAll();
              this.showToast('Imported config JSON successfully');
            } catch (err) {
              Swal.fire({ icon: 'error', title: 'Invalid JSON', text: err.message, confirmButtonColor: '#005eb8' });
            }
          };
          reader.readAsText(e.target.files[0]);
        }
      });
    }

    // Copy JSON button
    const copyBtn = document.getElementById('btn-copy-json');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const str = JSON.stringify(this.schema, null, 2);
        navigator.clipboard.writeText(str).then(() => {
          this.showToast('JSON copied to clipboard!');
        }).catch(() => {
          Swal.fire({ title: 'JSON Schema', html: `<textarea class="form-control font-monospace small" rows="12">${str}</textarea>` });
        });
      });
    }

    // Download JSON button
    const dlBtn = document.getElementById('btn-download-json');
    if (dlBtn) {
      dlBtn.addEventListener('click', () => this.downloadJSON());
    }

    // Test in Runner redirect (fixed to ../index.html)
    const testBtn = document.getElementById('btn-test-in-runner');
    if (testBtn) {
      testBtn.addEventListener('click', () => this.launchInRunner());
    }

    // Add target column button
    const addColBtn = document.getElementById('btn-add-target-col');
    if (addColBtn) {
      addColBtn.addEventListener('click', () => this.addNewTargetColumn());
    }

    // Add new layout profile button
    const addLayoutBtn = document.getElementById('btn-add-layout');
    if (addLayoutBtn) {
      addLayoutBtn.addEventListener('click', () => this.addNewLayout());
    }

    // Metadata live update inputs
    ['meta-proj-id', 'meta-proj-name', 'meta-proj-version', 'meta-author-user', 'meta-author-email', 'meta-dest-url', 'meta-dest-token', 'meta-dest-headers'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.syncMetadataFromUI());
      }
    });
  }

  // =========================================================================
  // RENDERING & UI SYNC
  // =========================================================================

  renderAll() {
    this.renderMetadata();
    this.renderTargetColumns();
    this.renderCalculatedColumns();
    this.renderRowFilters();
    this.renderLayouts();
    this.renderJSONPreview();
    this.validateSchema();
    this.updateUndoRedoUI();
  }

  renderMetadata() {
    const s = this.schema;
    const setValue = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val !== undefined ? val : '';
    };

    setValue('meta-proj-id', s.projectId || '');
    setValue('meta-proj-name', s.name || '');
    setValue('meta-proj-version', s.version || '1.0.0');
    setValue('meta-author-user', (s.author && s.author.username) || '');
    setValue('meta-author-email', (s.author && s.author.email) || '');
    setValue('meta-dest-url', (s.destination && s.destination.postUrl) || '');

    // Authorization Bearer token & Custom Headers
    const authHeader = (s.destination && s.destination.headers) ? s.destination.headers.Authorization || '' : '';
    const cleanToken = authHeader.replace(/^Bearer\s+/i, '');
    setValue('meta-dest-token', cleanToken);

    // Other custom headers
    if (s.destination && s.destination.headers) {
      const customHeaders = { ...s.destination.headers };
      delete customHeaders.Authorization;
      delete customHeaders['Content-Type'];
      setValue('meta-dest-headers', Object.keys(customHeaders).length > 0 ? JSON.stringify(customHeaders) : '');
    } else {
      setValue('meta-dest-headers', '');
    }
  }

  syncMetadataFromUI() {
    const getValue = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    this.schema.projectId = getValue('meta-proj-id');
    this.schema.name = getValue('meta-proj-name');
    this.schema.version = getValue('meta-proj-version');
    if (!this.schema.author) this.schema.author = {};
    this.schema.author.username = getValue('meta-author-user');
    this.schema.author.email = getValue('meta-author-email');

    if (!this.schema.destination) this.schema.destination = {};
    this.schema.destination.postUrl = getValue('meta-dest-url');

    if (!this.schema.destination.headers) {
      this.schema.destination.headers = { "Content-Type": "application/json" };
    }

    // Embed Bearer token in headers
    const rawToken = getValue('meta-dest-token');
    if (rawToken) {
      this.schema.destination.headers["Authorization"] = rawToken.startsWith('Bearer ') ? rawToken : `Bearer ${rawToken}`;
    } else {
      delete this.schema.destination.headers["Authorization"];
    }

    // Additional custom headers
    const rawCustomHeaders = getValue('meta-dest-headers');
    if (rawCustomHeaders) {
      try {
        const parsed = JSON.parse(rawCustomHeaders);
        Object.assign(this.schema.destination.headers, parsed);
      } catch (e) {
        // Ignored while typing
      }
    }

    this.renderJSONPreview();
    this.validateSchema();
  }

  // =========================================================================
  // TARGET COLUMNS BUILDER (COMPACT TOOLBAR DESIGN MATCHING USER SPEC)
  // [REQUIRED TOGGLE] [Display Label] [Default Value] [(1) Validation] [(1) Transformation] [BIN ICON]
  // =========================================================================

  renderTargetColumns() {
    const container = document.getElementById('builder-target-cols-container');
    const badgeCount = document.getElementById('target-cols-count-badge');
    if (!container) return;

    const cols = this.schema.targetColumns || [];
    if (badgeCount) badgeCount.textContent = cols.length;

    if (cols.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-muted bg-light rounded border border-dashed">
          <i class="bi bi-columns fs-3 d-block mb-1 text-secondary"></i>
          <div>No target columns configured yet.</div>
          <small>Click "Add Column" or drop a customer sample file to auto-scaffold.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    cols.forEach((col, idx) => {
      const valCount = (col.defaultValidations || []).length;
      const transformsList = col.transforms || (col.transform ? [col.transform] : []);
      const transCount = transformsList.length;

      const card = document.createElement('div');
      card.className = 'glass-card p-2 mb-2 border shadow-xs d-flex align-items-center gap-2 flex-nowrap overflow-x-auto';
      card.innerHTML = `
        <!-- 1. REQUIRED TOGGLE -->
        <button type="button" class="btn btn-sm ${col.required ? 'btn-primary' : 'btn-outline-primary'} fw-semibold col-req-toggle" data-index="${idx}" style="min-width: 105px; flex-shrink: 0;" title="Click to toggle Required / Optional">
          <i class="bi ${col.required ? 'bi-check-circle-fill' : 'bi-circle'} me-1"></i>${col.required ? 'Required' : 'Optional'}
        </button>

        <!-- 2. Display Label -->
        <div class="flex-grow-1" style="min-width: 160px;">
          <input type="text" class="form-control form-control-sm col-label-input fw-semibold" value="${(col.label || '').replace(/"/g, '&quot;')}" placeholder="Display Label" data-index="${idx}" title="Display Label">
        </div>

        <!-- 3. Default Value -->
        <div style="min-width: 130px; max-width: 180px; flex-shrink: 0;">
          <input type="text" class="form-control form-control-sm col-def-input" value="${col.defaultValue !== undefined ? String(col.defaultValue).replace(/"/g, '&quot;') : ''}" placeholder="Default Value" data-index="${idx}" title="Default fallback value if empty">
        </div>

        <!-- 4. Validation Pill Button -->
        <button type="button" class="btn btn-sm ${valCount > 0 ? 'btn-primary' : 'btn-outline-primary'} btn-open-val-modal fw-medium" data-index="${idx}" style="min-width: 130px; flex-shrink: 0;" title="Configure Validations">
          <i class="bi bi-shield-check me-1"></i>(${valCount}) Validation
        </button>

        <!-- 5. Transformation Pill Button -->
        <button type="button" class="btn btn-sm ${transCount > 0 ? 'btn-primary' : 'btn-outline-primary'} btn-open-trans-modal fw-medium" data-index="${idx}" style="min-width: 155px; flex-shrink: 0;" title="Configure Transformations">
          <i class="bi bi-magic me-1"></i>(${transCount}) Transformation
        </button>

        <!-- 6. Delete Bin Icon -->
        <button type="button" class="btn btn-sm btn-outline-danger btn-delete-col d-flex align-items-center justify-content-center" data-index="${idx}" style="width: 36px; height: 31px; flex-shrink: 0;" title="Delete Column">
          <i class="bi bi-trash3"></i>
        </button>
      `;

      container.appendChild(card);
    });

    // Event listeners
    container.querySelectorAll('.col-req-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index);
        this.schema.targetColumns[idx].required = !this.schema.targetColumns[idx].required;
        this.pushHistory();
        this.renderTargetColumns();
        this.renderJSONPreview();
        this.validateSchema();
      });
    });

    container.querySelectorAll('.col-label-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const col = this.schema.targetColumns[idx];
        col.label = e.target.value;
        if (!col.key) {
          col.key = (col.label || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        }
        this.renderJSONPreview();
      });
      el.addEventListener('change', () => {
        this.pushHistory();
      });
    });

    container.querySelectorAll('.col-def-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.targetColumns[idx].defaultValue = e.target.value;
        this.renderJSONPreview();
      });
      el.addEventListener('change', () => {
        this.pushHistory();
      });
    });

    container.querySelectorAll('.btn-open-val-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index);
        this.openValidationModal(idx);
      });
    });

    container.querySelectorAll('.btn-open-trans-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index);
        this.openTransformModal(idx);
      });
    });

    container.querySelectorAll('.btn-delete-col').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index);
        const removed = this.schema.targetColumns.splice(idx, 1)[0];
        if (removed) {
          (this.schema.layouts || []).forEach(l => {
            l.mappings = (l.mappings || []).filter(m => m.targetColumn !== removed.key);
          });
        }
        this.pushHistory();
        this.renderTargetColumns();
        this.renderLayouts();
        this.renderJSONPreview();
        this.validateSchema();
      });
    });
  }

  // =========================================================================
  // VALIDATIONS MODAL LIFECYCLE
  // =========================================================================

  openValidationModal(colIdx) {
    this.editingColIndex = colIdx;
    const col = this.schema.targetColumns[colIdx];
    if (!col) return;

    document.getElementById('val-modal-col-name').textContent = `${col.label || col.key} Validations`;
    const availableRules = ['IsNHSNumber', 'IsPostcode', 'IsEmail', 'IsPhoneNumber', 'IsNumber', 'IsInteger', 'IsAlphanumeric', 'MinValue', 'MaxValue', 'MatchRegex'];
    const currentRules = col.defaultValidations || [];

    const container = document.getElementById('val-modal-rules-list');
    container.innerHTML = availableRules.map(rule => {
      let isChecked = false;
      if (rule === 'MatchRegex') {
        isChecked = currentRules.some(r => (typeof r === 'object' && r.type === 'MatchRegex') || r === 'MatchRegex');
      } else if (rule === 'MinValue') {
        isChecked = currentRules.some(r => typeof r === 'object' && r.type === 'MinValue');
      } else if (rule === 'MaxValue') {
        isChecked = currentRules.some(r => typeof r === 'object' && r.type === 'MaxValue');
      } else {
        isChecked = currentRules.some(r => (typeof r === 'string' ? r : r.type) === rule);
      }

      return `
        <button type="button" class="btn btn-sm ${isChecked ? 'btn-primary' : 'btn-outline-secondary'} val-rule-btn py-1 px-2" data-rule="${rule}">
          <i class="bi ${isChecked ? 'bi-check-circle-fill' : 'bi-plus-circle'} me-1"></i>${rule}
        </button>
      `;
    }).join('');

    // Toggle numeric range & regex configuration boxes
    const hasMin = currentRules.find(r => typeof r === 'object' && r.type === 'MinValue');
    const hasMax = currentRules.find(r => typeof r === 'object' && r.type === 'MaxValue');
    const hasRegex = currentRules.find(r => typeof r === 'object' && r.type === 'MatchRegex');

    const rangeBox = document.getElementById('val-modal-range-box');
    const regexBox = document.getElementById('val-modal-regex-box');

    rangeBox.classList.toggle('d-none', !(hasMin || hasMax));
    regexBox.classList.toggle('d-none', !hasRegex);

    document.getElementById('val-modal-min').value = hasMin ? hasMin.min : '';
    document.getElementById('val-modal-max').value = hasMax ? hasMax.max : '';
    document.getElementById('val-modal-regex-pattern').value = hasRegex ? hasRegex.pattern || '' : '';
    document.getElementById('val-modal-regex-msg').value = hasRegex ? hasRegex.errorMessage || '' : '';

    container.querySelectorAll('.val-rule-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rName = e.currentTarget.dataset.rule;
        const isNowActive = e.currentTarget.classList.toggle('btn-primary');
        e.currentTarget.classList.toggle('btn-outline-secondary', !isNowActive);
        e.currentTarget.innerHTML = `<i class="bi ${isNowActive ? 'bi-check-circle-fill' : 'bi-plus-circle'} me-1"></i>${rName}`;

        if (rName === 'MinValue' || rName === 'MaxValue') {
          const anyNum = container.querySelector('[data-rule="MinValue"].btn-primary') || container.querySelector('[data-rule="MaxValue"].btn-primary');
          rangeBox.classList.toggle('d-none', !anyNum);
        } else if (rName === 'MatchRegex') {
          regexBox.classList.toggle('d-none', !isNowActive);
        }
      });
    });

    const saveBtn = document.getElementById('btn-save-val-modal');
    saveBtn.onclick = () => {
      const selectedRules = [];
      container.querySelectorAll('.val-rule-btn.btn-primary').forEach(btn => {
        const r = btn.dataset.rule;
        if (r === 'MinValue') {
          const minVal = parseFloat(document.getElementById('val-modal-min').value);
          if (!isNaN(minVal)) selectedRules.push({ type: 'MinValue', min: minVal });
        } else if (r === 'MaxValue') {
          const maxVal = parseFloat(document.getElementById('val-modal-max').value);
          if (!isNaN(maxVal)) selectedRules.push({ type: 'MaxValue', max: maxVal });
        } else if (r === 'MatchRegex') {
          selectedRules.push({
            type: 'MatchRegex',
            pattern: document.getElementById('val-modal-regex-pattern').value.trim() || '^[A-Za-z0-9_]+$',
            errorMessage: document.getElementById('val-modal-regex-msg').value.trim() || 'Invalid format'
          });
        } else {
          selectedRules.push(r);
        }
      });

      col.defaultValidations = selectedRules;
      const modal = bootstrap.Modal.getInstance(document.getElementById('modal-col-validations'));
      if (modal) modal.hide();

      this.pushHistory();
      this.renderTargetColumns();
      this.renderJSONPreview();
    };

    const modal = new bootstrap.Modal(document.getElementById('modal-col-validations'));
    modal.show();
  }

  // =========================================================================
  // TRANSFORMATIONS & TYPE CASTING MODAL LIFECYCLE
  // =========================================================================

  openTransformModal(colIdx) {
    this.editingColIndex = colIdx;
    const col = this.schema.targetColumns[colIdx];
    if (!col) return;

    document.getElementById('trans-modal-col-name').textContent = `${col.label || col.key} Transforms`;
    let transforms = JSON.parse(JSON.stringify(col.transforms || (col.transform ? [col.transform] : [])));

    const renderPipeline = () => {
      const container = document.getElementById('trans-modal-pipeline-list');
      const emptyMsg = document.getElementById('trans-modal-empty-msg');
      emptyMsg.classList.toggle('d-none', transforms.length > 0);
      container.innerHTML = '';

      transforms.forEach((t, tIdx) => {
        const tType = typeof t === 'string' ? t.toUpperCase() : (t.type || '').toUpperCase();
        const isCast = tType.startsWith('CAST_');
        const item = document.createElement('div');
        item.className = 'd-flex align-items-center justify-content-between p-2 bg-light rounded border';
        
        let extraConfigHtml = '';
        if (tType === 'CAST_FLOAT') {
          const prec = typeof t === 'object' && t.precision !== undefined ? t.precision : 2;
          extraConfigHtml = `
            <div class="d-flex align-items-center gap-1 ms-2">
              <span class="small text-muted">Precision:</span>
              <input type="number" class="form-control form-control-sm trans-prec-input" data-index="${tIdx}" value="${prec}" min="0" max="6" style="width: 60px;">
            </div>
          `;
        } else if (tType === 'CAST_DATE' || tType === 'DATE_FORMAT') {
          const src = typeof t === 'object' ? t.dateFormatSource || 'DD/MM/YYYY' : 'DD/MM/YYYY';
          const tgt = typeof t === 'object' ? t.dateFormatTarget || 'YYYY-MM-DD' : 'YYYY-MM-DD';
          extraConfigHtml = `
            <div class="d-flex align-items-center gap-1 ms-2">
              <input type="text" class="form-control form-control-sm trans-datesrc-input font-monospace" data-index="${tIdx}" value="${src}" placeholder="Source (DD/MM/YYYY)" style="width: 105px;">
              <span>&rarr;</span>
              <input type="text" class="form-control form-control-sm trans-datetgt-input font-monospace" data-index="${tIdx}" value="${tgt}" placeholder="Target (YYYY-MM-DD)" style="width: 105px;">
            </div>
          `;
        }

        item.innerHTML = `
          <div class="d-flex align-items-center gap-2">
            <span class="badge ${isCast ? 'bg-primary' : 'bg-info'} text-white font-monospace">${tIdx + 1}. ${tType}</span>
            ${extraConfigHtml}
          </div>
          <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 btn-remove-trans-step" data-index="${tIdx}">
            <i class="bi bi-x-lg"></i>
          </button>
        `;
        container.appendChild(item);
      });

      container.querySelectorAll('.btn-remove-trans-step').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.currentTarget.dataset.index);
          transforms.splice(idx, 1);
          renderPipeline();
        });
      });

      container.querySelectorAll('.trans-prec-input').forEach(input => {
        input.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.index);
          if (typeof transforms[idx] === 'string') transforms[idx] = { type: transforms[idx] };
          transforms[idx].precision = parseInt(e.target.value) || 2;
        });
      });

      container.querySelectorAll('.trans-datesrc-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const idx = parseInt(e.target.dataset.index);
          if (typeof transforms[idx] === 'string') transforms[idx] = { type: transforms[idx] };
          transforms[idx].dateFormatSource = e.target.value.trim();
        });
      });

      container.querySelectorAll('.trans-datetgt-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const idx = parseInt(e.target.dataset.index);
          if (typeof transforms[idx] === 'string') transforms[idx] = { type: transforms[idx] };
          transforms[idx].dateFormatTarget = e.target.value.trim();
        });
      });
    };

    renderPipeline();

    document.getElementById('btn-add-trans-step').onclick = () => {
      const select = document.getElementById('trans-modal-add-select');
      const val = select.value;
      if (!val) return;
      if (val === 'cast_float') {
        transforms.push({ type: 'CAST_FLOAT', precision: 2 });
      } else if (val === 'cast_date' || val === 'date_format') {
        transforms.push({ type: 'CAST_DATE', dateFormatSource: 'DD/MM/YYYY', dateFormatTarget: 'YYYY-MM-DD' });
      } else {
        transforms.push(val.toUpperCase());
      }
      select.value = '';
      renderPipeline();
    };

    document.getElementById('btn-save-trans-modal').onclick = () => {
      col.transforms = transforms;
      delete col.transform; // Clean up legacy single transform

      // Sync with layout mappings
      (this.schema.layouts || []).forEach(layout => {
        const m = (layout.mappings || []).find(x => x.targetColumn === col.key);
        if (m) {
          m.transforms = transforms;
          delete m.transform;
        }
      });

      const modal = bootstrap.Modal.getInstance(document.getElementById('modal-col-transforms'));
      if (modal) modal.hide();

      this.pushHistory();
      this.renderTargetColumns();
      this.renderLayouts();
      this.renderJSONPreview();
    };

    const modal = new bootstrap.Modal(document.getElementById('modal-col-transforms'));
    modal.show();
  }

  // =========================================================================
  // CALCULATED COLUMNS (VIRTUAL FIELDS)
  // =========================================================================

  renderCalculatedColumns() {
    const container = document.getElementById('builder-calc-cols-container');
    const badgeCount = document.getElementById('calc-cols-count-badge');
    if (!container) return;

    if (!this.schema.calculatedColumns) this.schema.calculatedColumns = [];
    const calcs = this.schema.calculatedColumns;
    if (badgeCount) badgeCount.textContent = calcs.length;

    if (calcs.length === 0) {
      container.innerHTML = `
        <div class="text-center py-3 text-muted bg-light rounded border border-dashed">
          <small>No calculated formula fields. Click "+ Add Formula Field" to derive calculated values.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    const allCols = (this.schema.targetColumns || []).map(c => c.key);

    calcs.forEach((calc, idx) => {
      const card = document.createElement('div');
      card.className = 'glass-card p-2 mb-2 border shadow-xs d-flex flex-wrap align-items-center gap-2';
      card.innerHTML = `
        <div class="d-flex align-items-center gap-1" style="min-width: 170px;">
          <span class="badge bg-info text-white small font-monospace">calc</span>
          <input type="text" class="form-control form-control-sm calc-key-input font-monospace" data-index="${idx}" value="${calc.key || ''}" placeholder="column_id" title="Calculated Column Key">
        </div>

        <div style="min-width: 160px;">
          <input type="text" class="form-control form-control-sm calc-label-input fw-semibold" data-index="${idx}" value="${calc.label || ''}" placeholder="Display Label">
        </div>

        <div class="d-flex align-items-center gap-1 flex-grow-1" style="min-width: 280px;">
          <div class="input-group input-group-sm">
            <span class="input-group-text bg-light small">=</span>
            <input type="text" class="form-control font-monospace calc-expr-input" data-index="${idx}" value="${calc.expression || ''}" placeholder="[qty] * [price]">
            <button class="btn btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" title="Insert Column Token">
              Token
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><h6 class="dropdown-header small">Available Columns</h6></li>
              ${allCols.map(c => `<li><a class="dropdown-item small font-monospace calc-token-item" href="#" data-index="${idx}" data-token="[${c}]">[${c}]</a></li>`).join('')}
            </ul>
          </div>
        </div>

        <div style="min-width: 110px;">
          <select class="form-select form-select-sm calc-type-select" data-index="${idx}">
            <option value="float" ${calc.type === 'float' ? 'selected' : ''}>Float</option>
            <option value="integer" ${calc.type === 'integer' ? 'selected' : ''}>Integer</option>
            <option value="string" ${calc.type === 'string' ? 'selected' : ''}>String</option>
            <option value="boolean" ${calc.type === 'boolean' ? 'selected' : ''}>Boolean</option>
          </select>
        </div>

        <button type="button" class="btn btn-sm btn-outline-danger px-2 btn-delete-calc" data-index="${idx}" title="Delete Calculated Field">
          <i class="bi bi-trash"></i>
        </button>
      `;

      container.appendChild(card);
    });

    container.querySelectorAll('.calc-key-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.calculatedColumns[idx].key = e.target.value.trim();
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.calc-label-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.calculatedColumns[idx].label = e.target.value;
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.calc-expr-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.calculatedColumns[idx].expression = e.target.value;
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.calc-type-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.calculatedColumns[idx].type = e.target.value;
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.calc-token-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(e.currentTarget.dataset.index);
        const token = e.currentTarget.dataset.token;
        const calc = this.schema.calculatedColumns[idx];
        calc.expression = (calc.expression ? `${calc.expression} ` : '') + token;
        this.renderCalculatedColumns();
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.btn-delete-calc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index);
        this.schema.calculatedColumns.splice(idx, 1);
        this.pushHistory();
        this.renderCalculatedColumns();
        this.renderJSONPreview();
      });
    });
  }

  addNewCalculatedColumn() {
    if (!this.schema.calculatedColumns) this.schema.calculatedColumns = [];
    const count = this.schema.calculatedColumns.length + 1;
    this.schema.calculatedColumns.push({
      key: `calc_total_${count}`,
      label: `Total Metric ${count}`,
      expression: "[client_id] + '-01'",
      type: "string"
    });
    this.pushHistory();
    this.renderCalculatedColumns();
    this.renderJSONPreview();
  }

  // =========================================================================
  // INGESTION ROW FILTERS
  // =========================================================================

  renderRowFilters() {
    const container = document.getElementById('builder-row-filters-container');
    const badgeCount = document.getElementById('row-filters-count-badge');
    if (!container) return;

    if (!this.schema.rowFilters) this.schema.rowFilters = { combine: 'AND', rules: [] };
    const rules = this.schema.rowFilters.rules || [];
    if (badgeCount) badgeCount.textContent = rules.length;

    const combineSelect = document.getElementById('filter-combine-mode');
    if (combineSelect) combineSelect.value = this.schema.rowFilters.combine || 'AND';

    if (rules.length === 0) {
      container.innerHTML = `
        <div class="text-center py-3 text-muted bg-light rounded border border-dashed">
          <small>No pre-filters active. All mapped rows enter the validation grid. Click "+ Add Row Filter" to exclude rows.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    const allCols = (this.schema.targetColumns || []).map(c => c.key);

    rules.forEach((rule, idx) => {
      const card = document.createElement('div');
      card.className = 'glass-card p-2 mb-2 border shadow-xs d-flex flex-wrap align-items-center gap-2';
      card.innerHTML = `
        <div style="min-width: 170px;">
          <select class="form-select form-select-sm font-monospace filter-col-select" data-index="${idx}">
            <option value="">-- Target Column --</option>
            ${allCols.map(c => `<option value="${c}" ${rule.column === c ? 'selected' : ''}>[${c}]</option>`).join('')}
          </select>
        </div>

        <div style="min-width: 110px;">
          <select class="form-select form-select-sm filter-op-select font-monospace" data-index="${idx}">
            <option value="=" ${rule.op === '=' ? 'selected' : ''}>= (Equals)</option>
            <option value="!=" ${rule.op === '!=' ? 'selected' : ''}>!= (Not Equals)</option>
            <option value=">" ${rule.op === '>' ? 'selected' : ''}>&gt; (Greater)</option>
            <option value=">=" ${rule.op === '>=' ? 'selected' : ''}>&gt;= (Greater or Equal)</option>
            <option value="<" ${rule.op === '<' ? 'selected' : ''}>&lt; (Less)</option>
            <option value="<=" ${rule.op === '<=' ? 'selected' : ''}>&lt;= (Less or Equal)</option>
            <option value="contains" ${rule.op === 'contains' ? 'selected' : ''}>contains</option>
            <option value="not_empty" ${rule.op === 'not_empty' ? 'selected' : ''}>not_empty</option>
          </select>
        </div>

        <div class="flex-grow-1" style="min-width: 160px;">
          <input type="text" class="form-control form-control-sm filter-val-input ${rule.op === 'not_empty' ? 'd-none' : ''}" data-index="${idx}" value="${rule.value !== undefined ? rule.value : ''}" placeholder="Filter Value (e.g. 0 or SUPPLIER_B)">
        </div>

        <div style="min-width: 100px;">
          <select class="form-select form-select-sm filter-type-select" data-index="${idx}">
            <option value="number" ${rule.type === 'number' ? 'selected' : ''}>Number</option>
            <option value="string" ${rule.type === 'string' ? 'selected' : ''}>String</option>
          </select>
        </div>

        <button type="button" class="btn btn-sm btn-outline-danger px-2 btn-delete-filter" data-index="${idx}" title="Delete Filter">
          <i class="bi bi-trash"></i>
        </button>
      `;

      container.appendChild(card);
    });

    container.querySelectorAll('.filter-col-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.rowFilters.rules[idx].column = e.target.value;
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.filter-op-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.rowFilters.rules[idx].op = e.target.value;
        this.renderRowFilters();
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.filter-val-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.rowFilters.rules[idx].value = e.target.value;
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.filter-type-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.schema.rowFilters.rules[idx].type = e.target.value;
        this.renderJSONPreview();
      });
    });

    container.querySelectorAll('.btn-delete-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index);
        this.schema.rowFilters.rules.splice(idx, 1);
        this.pushHistory();
        this.renderRowFilters();
        this.renderJSONPreview();
      });
    });
  }

  addNewRowFilter() {
    if (!this.schema.rowFilters) this.schema.rowFilters = { combine: 'AND', rules: [] };
    const firstCol = (this.schema.targetColumns && this.schema.targetColumns[0]) ? this.schema.targetColumns[0].key : 'sale_value';
    this.schema.rowFilters.rules.push({
      column: firstCol,
      op: '>',
      value: '0',
      type: 'number'
    });
    this.pushHistory();
    this.renderRowFilters();
    this.renderJSONPreview();
  }

  updateFilterCombineMode(mode) {
    if (!this.schema.rowFilters) this.schema.rowFilters = { combine: 'AND', rules: [] };
    this.schema.rowFilters.combine = mode;
    this.pushHistory();
    this.renderJSONPreview();
  }

  addNewTargetColumn() {
    if (!this.schema.targetColumns) this.schema.targetColumns = [];
    const count = this.schema.targetColumns.length + 1;
    const newCol = {
      key: `field_${count}`,
      label: `Field ${count}`,
      required: false,
      defaultValue: "",
      defaultValidations: [],
      transforms: ["TRIM"]
    };
    this.schema.targetColumns.push(newCol);
    this.syncLayoutMappingsKeys();
    this.pushHistory();
    this.renderTargetColumns();
    this.renderLayouts();
    this.renderJSONPreview();
    this.validateSchema();
  }

  syncLayoutMappingsKeys() {
    const targetKeys = (this.schema.targetColumns || []).map(c => c.key);
    (this.schema.layouts || []).forEach(layout => {
      if (!layout.mappings) layout.mappings = [];
      targetKeys.forEach(tKey => {
        if (!layout.mappings.some(m => m.targetColumn === tKey)) {
          layout.mappings.push({
            sourceColumn: "",
            targetColumn: tKey,
            transforms: ["TRIM"],
            defaultValue: "",
            validations: []
          });
        }
      });
    });
  }

  // =========================================================================
  // PROVIDER LAYOUTS BUILDER (WITH CSV/TSV GRAYOUT & DATE_PARSE LOGIC)
  // =========================================================================

  renderLayouts() {
    const tabsContainer = document.getElementById('builder-layout-tabs');
    const layoutEditor = document.getElementById('builder-layout-editor');
    if (!tabsContainer || !layoutEditor) return;

    const layouts = this.schema.layouts || [];
    if (this.activeLayoutIndex >= layouts.length) this.activeLayoutIndex = Math.max(0, layouts.length - 1);

    // Render Tabs
    tabsContainer.innerHTML = '';
    layouts.forEach((layout, idx) => {
      const tab = document.createElement('li');
      tab.className = 'nav-item';
      tab.innerHTML = `
        <button class="nav-link ${idx === this.activeLayoutIndex ? 'active fw-bold' : ''} d-flex align-items-center gap-1" data-index="${idx}">
          <span class="badge bg-secondary text-uppercase">${layout.fileType || 'csv'}</span>
          <span>${layout.name || layout.id}</span>
          ${layouts.length > 1 ? `<span class="btn-close btn-close-white ms-1 delete-layout-btn" data-index="${idx}" style="font-size:0.6rem;"></span>` : ''}
        </button>
      `;
      tab.querySelector('button').addEventListener('click', (e) => {
        if (!e.target.classList.contains('delete-layout-btn')) {
          this.activeLayoutIndex = idx;
          this.renderLayouts();
        }
      });
      const delBtn = tab.querySelector('.delete-layout-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteLayout(idx);
        });
      }
      tabsContainer.appendChild(tab);
    });

    // Render Active Layout Settings
    const activeLayout = layouts[this.activeLayoutIndex];
    if (!activeLayout) {
      layoutEditor.innerHTML = '<div class="text-muted p-3">No layout selected.</div>';
      return;
    }

    const fileType = (activeLayout.fileType || 'xlsx').toLowerCase();
    const isDelimited = ['csv', 'tsv'].includes(fileType);
    const sheetMode = (activeLayout.sheetStrategy && activeLayout.sheetStrategy.mode) || 'first_sheet';
    const offsetX = (activeLayout.offset && activeLayout.offset.offsetX) || 0;
    const offsetY = (activeLayout.offset && activeLayout.offset.offsetY) || 0;

    // Pattern label and placeholder based on sheet mode
    let patternLabel = "Preset Sheet Name:";
    let patternPlaceholder = "e.g. Patients or ActiveData";
    let patternValue = activeLayout.sheetStrategy ? (activeLayout.sheetStrategy.presetName || '') : '';

    if (sheetMode === 'regex') {
      patternLabel = "Sheet Regex Pattern:";
      patternPlaceholder = "e.g. ^(Patient|Data).*$";
      patternValue = activeLayout.sheetStrategy ? (activeLayout.sheetStrategy.regexPattern || '') : '';
    } else if (sheetMode === 'date_parse') {
      patternLabel = "Sheet Date Format (Selects Latest Sheet):";
      patternPlaceholder = "e.g. YYYY-MM-DD or DD-MM-YYYY or MMMM-YYYY";
      patternValue = activeLayout.sheetStrategy ? (activeLayout.sheetStrategy.dateFormatString || 'YYYY-MM-DD') : 'YYYY-MM-DD';
    } else if (sheetMode === 'first_sheet') {
      patternLabel = "Sheet Strategy Note:";
      patternPlaceholder = "First sheet in workbook automatically selected";
      patternValue = "";
    }

    layoutEditor.innerHTML = `
      <div class="p-3 bg-light rounded border mb-3">
        <div class="row g-2 mb-2">
          <div class="col-md-4">
            <label class="small fw-bold text-dark">Layout ID:</label>
            <input type="text" id="cur-layout-id" class="form-control form-control-sm font-monospace" value="${activeLayout.id || ''}">
          </div>
          <div class="col-md-5">
            <label class="small fw-bold text-dark">Display Name:</label>
            <input type="text" id="cur-layout-name" class="form-control form-control-sm" value="${activeLayout.name || ''}">
          </div>
          <div class="col-md-3">
            <label class="small fw-bold text-dark">File Type:</label>
            <select id="cur-layout-filetype" class="form-select form-select-sm">
              <option value="xlsx" ${fileType === 'xlsx' ? 'selected' : ''}>XLSX (Excel Workbook)</option>
              <option value="csv" ${fileType === 'csv' ? 'selected' : ''}>CSV (Delimited Stream)</option>
              <option value="tsv" ${fileType === 'tsv' ? 'selected' : ''}>TSV (Tab-Separated)</option>
            </select>
          </div>
        </div>

        <div class="row g-2 align-items-end ${isDelimited ? 'opacity-50' : ''}">
          <div class="col-md-4">
            <label class="small fw-bold text-dark d-flex align-items-center gap-1">
              Sheet Strategy:
              ${isDelimited ? '<span class="badge bg-secondary" style="font-size:0.6rem;">N/A for CSV</span>' : ''}
            </label>
            <select id="cur-layout-sheet-mode" class="form-select form-select-sm" ${isDelimited ? 'disabled title="Sheet strategy is disabled for flat delimited files (.csv, .tsv)" data-bs-toggle="tooltip"' : ''}>
              <option value="first_sheet" ${sheetMode === 'first_sheet' ? 'selected' : ''}>First Sheet (Default)</option>
              <option value="preset" ${sheetMode === 'preset' ? 'selected' : ''}>Preset Name</option>
              <option value="regex" ${sheetMode === 'regex' ? 'selected' : ''}>Regex Pattern</option>
              <option value="date_parse" ${sheetMode === 'date_parse' ? 'selected' : ''}>Date String Match (Selects Latest Sheet)</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="small fw-bold text-dark" id="cur-layout-sheet-pattern-label">${patternLabel}</label>
            <input type="text" id="cur-layout-sheet-pattern" class="form-control form-control-sm font-monospace" 
                   value="${patternValue}" 
                   placeholder="${patternPlaceholder}" 
                   ${isDelimited || sheetMode === 'first_sheet' ? 'disabled' : ''}
                   ${isDelimited ? 'title="Sheet strategy is disabled for flat delimited files (.csv, .tsv)" data-bs-toggle="tooltip"' : ''}>
          </div>
          <div class="col-md-2">
            <label class="small fw-bold text-dark">Header Row (Y):</label>
            <input type="number" id="cur-layout-offset-y" class="form-control form-control-sm font-monospace" min="0" value="${offsetY}">
          </div>
          <div class="col-md-2">
            <label class="small fw-bold text-dark">Column (X):</label>
            <input type="number" id="cur-layout-offset-x" class="form-control form-control-sm font-monospace" min="0" value="${offsetX}">
          </div>
        </div>
        ${isDelimited ? `
          <div class="small text-muted mt-2 d-flex align-items-center gap-1">
            <i class="bi bi-info-circle-fill text-secondary"></i>
            <span>Flat delimited files (.csv, .tsv) only contain a single data stream and bypass worksheet selection.</span>
          </div>
        ` : ''}
      </div>

      <!-- Column Mapping Matrix -->
      <h6 class="fw-bold text-dark small mb-2"><i class="bi bi-arrow-left-right text-primary"></i> Column Translation & Transformation Matrix</h6>
      <div id="layout-mappings-matrix">
        <!-- Rendered below -->
      </div>
    `;

    // Hook inputs on active layout
    const idInput = document.getElementById('cur-layout-id');
    const nameInput = document.getElementById('cur-layout-name');
    const fileTypeSel = document.getElementById('cur-layout-filetype');
    const sheetModeSel = document.getElementById('cur-layout-sheet-mode');
    const sheetPatternInput = document.getElementById('cur-layout-sheet-pattern');
    const offsetYInput = document.getElementById('cur-layout-offset-y');
    const offsetXInput = document.getElementById('cur-layout-offset-x');

    const syncLayoutMeta = () => {
      activeLayout.id = idInput.value.trim();
      activeLayout.name = nameInput.value.trim();
      const prevFileType = activeLayout.fileType;
      activeLayout.fileType = fileTypeSel.value;

      if (!activeLayout.sheetStrategy) activeLayout.sheetStrategy = {};
      activeLayout.sheetStrategy.mode = sheetModeSel.value;
      if (sheetModeSel.value === 'preset') activeLayout.sheetStrategy.presetName = sheetPatternInput.value.trim();
      else if (sheetModeSel.value === 'regex') activeLayout.sheetStrategy.regexPattern = sheetPatternInput.value.trim();
      else if (sheetModeSel.value === 'date_parse') activeLayout.sheetStrategy.dateFormatString = sheetPatternInput.value.trim() || 'YYYY-MM-DD';

      if (!activeLayout.offset) activeLayout.offset = { autoDetect: true, maxColumns: "Auto", maxRows: "Auto" };
      activeLayout.offset.offsetY = parseInt(offsetYInput.value) || 0;
      activeLayout.offset.offsetX = parseInt(offsetXInput.value) || 0;

      // Re-render if fileType or sheetMode changed to reflect disabled / pattern inputs
      if (prevFileType !== activeLayout.fileType || sheetModeSel.dataset.lastMode !== sheetModeSel.value) {
        sheetModeSel.dataset.lastMode = sheetModeSel.value;
        this.renderLayouts();
      }

      this.renderJSONPreview();
      this.validateSchema();
    };

    [idInput, nameInput, offsetYInput, offsetXInput, sheetPatternInput].forEach(el => {
      if (el) el.addEventListener('input', syncLayoutMeta);
    });

    [fileTypeSel, sheetModeSel].forEach(el => {
      if (el) el.addEventListener('change', syncLayoutMeta);
    });

    // Render Mappings Matrix
    const matrixContainer = document.getElementById('layout-mappings-matrix');
    const targetCols = this.schema.targetColumns || [];
    const mappings = activeLayout.mappings || [];

    if (targetCols.length === 0) {
      matrixContainer.innerHTML = '<div class="alert alert-warning small mb-0">No target columns defined. Add target columns above to configure mappings.</div>';
      return;
    }

    let matrixHtml = `
      <div class="table-responsive">
        <table class="table table-sm table-bordered align-middle small bg-white text-nowrap" style="min-width: 840px;">
          <thead class="table-light">
            <tr>
              <th style="width: 28%; min-width: 190px;">Target Column</th>
              <th style="width: 28%; min-width: 200px;">Source File Header</th>
              <th style="width: 24%; min-width: 190px;">Transform</th>
              <th style="width: 20%; min-width: 160px;">Default Fallback</th>
            </tr>
          </thead>
          <tbody>
    `;

    targetCols.forEach(tCol => {
      let m = mappings.find(x => x.targetColumn === tCol.key);
      if (!m) {
        m = {
          sourceColumn: "",
          targetColumn: tCol.key,
          transform: "TRIM",
          dateFormatSource: "DD/MM/YYYY",
          dateFormatTarget: "YYYY-MM-DD",
          defaultValue: tCol.defaultValue || "",
          validations: []
        };
        mappings.push(m);
      }

      const transforms = ['NONE', 'TRIM', 'UPPERCASE', 'LOWERCASE', 'CAPITALIZE', 'DATE_FORMAT'];

      matrixHtml += `
        <tr>
          <td style="min-width: 190px;">
            <div class="fw-bold text-dark">${tCol.label}</div>
            <code class="text-muted small">${tCol.key}</code>
            ${tCol.required ? '<span class="badge bg-primary ms-1" style="font-size:0.65rem;">Required</span>' : '<span class="badge bg-light text-secondary border ms-1" style="font-size:0.65rem;">Optional</span>'}
          </td>
          <td style="min-width: 200px;">
            ${this.detectedHeaders.length > 0 
              ? `<select class="form-select form-select-sm matrix-source-select" data-target="${tCol.key}">
                   <option value="">-- Do Not Import / Skip --</option>
                   ${this.detectedHeaders.map(h => `<option value="${h}" ${h === m.sourceColumn ? 'selected' : ''}>${h}</option>`).join('')}
                 </select>`
              : `<input type="text" class="form-control form-control-sm matrix-source-input" data-target="${tCol.key}" value="${m.sourceColumn || ''}" placeholder="Header name in file">`
            }
          </td>
          <td style="min-width: 190px;">
            <select class="form-select form-select-sm matrix-trans-select" data-target="${tCol.key}">
              ${transforms.map(tr => `<option value="${tr}" ${tr === (m.transform || 'TRIM') ? 'selected' : ''}>${tr}</option>`).join('')}
            </select>
            ${m.transform === 'DATE_FORMAT' ? `
              <div class="d-flex gap-1 mt-1">
                <input type="text" class="form-control form-control-sm p-1 font-monospace matrix-date-src" data-target="${tCol.key}" value="${m.dateFormatSource || 'DD/MM/YYYY'}" placeholder="Src: DD/MM/YYYY" title="Source Date Pattern">
                <input type="text" class="form-control form-control-sm p-1 font-monospace matrix-date-tgt" data-target="${tCol.key}" value="${m.dateFormatTarget || 'YYYY-MM-DD'}" placeholder="Tgt: YYYY-MM-DD" title="Target Date Pattern">
              </div>
            ` : ''}
          </td>
          <td style="min-width: 160px;">
            <input type="text" class="form-control form-control-sm matrix-def-input" data-target="${tCol.key}" value="${m.defaultValue !== undefined ? m.defaultValue : ''}" placeholder="${tCol.defaultValue || 'Default'}">
          </td>
        </tr>
      `;
    });

    matrixHtml += `</tbody></table></div>`;
    matrixContainer.innerHTML = matrixHtml;

    // Listeners on mappings matrix
    matrixContainer.querySelectorAll('.matrix-source-select, .matrix-source-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const tKey = e.target.dataset.target;
        const m = mappings.find(x => x.targetColumn === tKey);
        if (m) m.sourceColumn = e.target.value.trim();
        this.renderJSONPreview();
        this.validateSchema();
      });
    });

    matrixContainer.querySelectorAll('.matrix-trans-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const tKey = e.target.dataset.target;
        const m = mappings.find(x => x.targetColumn === tKey);
        if (m) {
          m.transform = e.target.value;
          if (m.transform === 'DATE_FORMAT' && !m.dateFormatSource) {
            m.dateFormatSource = "DD/MM/YYYY";
            m.dateFormatTarget = "YYYY-MM-DD";
          }
        }
        this.renderLayouts();
        this.renderJSONPreview();
      });
    });

    matrixContainer.querySelectorAll('.matrix-date-src').forEach(el => {
      el.addEventListener('input', (e) => {
        const tKey = e.target.dataset.target;
        const m = mappings.find(x => x.targetColumn === tKey);
        if (m) m.dateFormatSource = e.target.value.trim();
        this.renderJSONPreview();
      });
    });

    matrixContainer.querySelectorAll('.matrix-date-tgt').forEach(el => {
      el.addEventListener('input', (e) => {
        const tKey = e.target.dataset.target;
        const m = mappings.find(x => x.targetColumn === tKey);
        if (m) m.dateFormatTarget = e.target.value.trim();
        this.renderJSONPreview();
      });
    });

    matrixContainer.querySelectorAll('.matrix-def-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const tKey = e.target.dataset.target;
        const m = mappings.find(x => x.targetColumn === tKey);
        if (m) m.defaultValue = e.target.value;
        this.renderJSONPreview();
      });
    });
  }

  addNewLayout() {
    if (!this.schema.layouts) this.schema.layouts = [];
    const count = this.schema.layouts.length + 1;
    const newLayout = {
      id: `layout_profile_${count}`,
      name: `Supplier Profile ${count}`,
      fileType: "xlsx",
      filePassword: "",
      sheetStrategy: { mode: "first_sheet", presetName: "", regexPattern: "", dateFormatString: "" },
      offset: { offsetX: 0, offsetY: 0, autoDetect: true, maxColumns: "Auto", maxRows: "Auto" },
      mappings: (this.schema.targetColumns || []).map(tCol => ({
        sourceColumn: "",
        targetColumn: tCol.key,
        transform: "TRIM",
        defaultValue: tCol.defaultValue || "",
        validations: (tCol.defaultValidations || []).map(v => ({ type: typeof v === 'string' ? v : v.type }))
      }))
    };
    this.schema.layouts.push(newLayout);
    this.activeLayoutIndex = this.schema.layouts.length - 1;
    this.renderLayouts();
    this.renderJSONPreview();
    this.validateSchema();
    this.showToast(`Created new profile: ${newLayout.name}`);
  }

  deleteLayout(idx) {
    if ((this.schema.layouts || []).length <= 1) {
      Swal.fire({ icon: 'warning', title: 'Cannot Delete', text: 'At least one supplier layout profile must remain in the schema.', confirmButtonColor: '#005eb8' });
      return;
    }
    const removed = this.schema.layouts.splice(idx, 1)[0];
    this.activeLayoutIndex = Math.max(0, this.activeLayoutIndex - 1);
    this.renderLayouts();
    this.renderJSONPreview();
    this.validateSchema();
    this.showToast(`Deleted layout: ${removed.name}`);
  }

  // =========================================================================
  // AUTO-SCAFFOLD FROM SAMPLE CUSTOMER FILE (CSV / XLSX)
  // =========================================================================

  async handleSampleFileUpload(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    Swal.fire({
      title: 'Analyzing Customer File...',
      text: `Inspecting ${file.name} to detect headers and infer schema rules...`,
      didOpen: () => Swal.showLoading()
    });

    try {
      let headers = [];
      let sampleRows = [];

      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = await file.text();
        const parsed = Papa.parse(text, { skipEmptyLines: true, preview: 15 });
        if (parsed.data && parsed.data.length > 0) {
          headers = parsed.data[0].map(h => String(h).trim()).filter(Boolean);
          sampleRows = parsed.data.slice(1);
        }
      } else if (['xlsx', 'xls'].includes(ext)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        if (wb.SheetNames.length > 0) {
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (matrix.length > 0) {
            headers = matrix[0].map(h => String(h).trim()).filter(Boolean);
            sampleRows = matrix.slice(1, 15);
          }
        }
      }

      if (headers.length === 0) {
        throw new Error("No headers could be detected in the provided file.");
      }

      this.detectedHeaders = headers;

      // Smart inference of columns, types, transforms
      const inferredTargetColumns = [];
      const inferredMappings = [];

      headers.forEach(header => {
        const norm = header.toLowerCase().replace(/[^a-z0-9]/g, '');
        let targetKey = header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        let targetLabel = header;
        let validations = [];
        let transform = "TRIM";
        let dateSrc = "DD/MM/YYYY";
        let dateTgt = "YYYY-MM-DD";
        let isRequired = false;
        let isIgnorable = false;
        let defaultValue = "";

        const values = sampleRows.map(r => {
          const idx = headers.indexOf(header);
          return idx !== -1 && r[idx] !== undefined ? String(r[idx]).trim() : '';
        }).filter(Boolean);

        // 1. NHS Number
        if (norm.includes('nhs') || values.some(v => /^\d{10}$/.test(v.replace(/\s+/g, '')))) {
          targetKey = 'nhs_number';
          targetLabel = 'NHS Number';
          validations = ['IsNHSNumber'];
          isRequired = true;
          transform = "TRIM";
        }
        // 2. Postcode
        else if (norm.includes('postcode') || norm.includes('postal') || values.some(v => /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(v))) {
          targetKey = 'postcode';
          targetLabel = 'Postcode';
          validations = ['IsPostcode'];
          transform = "UPPERCASE";
          defaultValue = "UNKNOWN";
        }
        // 3. Email
        else if (norm.includes('email') || values.some(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
          targetKey = 'email';
          targetLabel = 'Email Address';
          validations = ['IsEmail'];
          transform = "LOWERCASE";
        }
        // 4. Phone
        else if (norm.includes('phone') || norm.includes('contact') || norm.includes('tel') || norm.includes('mobile')) {
          targetKey = 'phone_number';
          targetLabel = 'Contact Number';
          validations = ['IsPhoneNumber'];
          isIgnorable = true;
          defaultValue = "N/A";
        }
        // 5. Date
        else if (norm.includes('date') || norm.includes('dob') || values.some(v => /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(v))) {
          validations = [];
          transform = "DATE_FORMAT";
          dateSrc = "DD/MM/YYYY";
          dateTgt = "YYYY-MM-DD";
        }
        // 6. Name
        else if (norm.includes('name')) {
          transform = "CAPITALIZE";
        }
        // 7. Integer / Age
        else if (norm.includes('age') || (values.length > 0 && values.every(v => /^-?\d+$/.test(v)))) {
          validations = ['IsInteger'];
          defaultValue = "0";
        }

        inferredTargetColumns.push({
          key: targetKey,
          label: targetLabel,
          required: isRequired,
          defaultValue: defaultValue,
          defaultValidations: validations,
          transforms: transform !== 'NONE' ? [transform] : []
        });

        inferredMappings.push({
          sourceColumn: header,
          targetColumn: targetKey,
          transform: transform,
          dateFormatSource: dateSrc,
          dateFormatTarget: dateTgt,
          defaultValue: defaultValue,
          validations: validations.map(v => ({ type: v }))
        });
      });

      // Update Schema
      this.schema.targetColumns = inferredTargetColumns;
      if (!this.schema.layouts || this.schema.layouts.length === 0) {
        this.schema.layouts = [this.getDefaultFallbackSchema().layouts[0]];
      }

      const activeLayout = this.schema.layouts[this.activeLayoutIndex];
      if (activeLayout) {
        activeLayout.fileType = ['xlsx', 'xls'].includes(ext) ? 'xlsx' : 'csv';
        activeLayout.name = `${file.name.split('.')[0]} Auto Profile`;
        activeLayout.mappings = inferredMappings;
      }

      this.renderAll();

      Swal.fire({
        icon: 'success',
        title: 'Auto-Scaffolding Complete!',
        html: `
          <p class="small text-muted mb-2">Detected <strong>${headers.length} headers</strong> from <code>${file.name}</code>.</p>
          <div class="text-start small p-2 bg-light rounded max-h-120 overflow-auto">
            ${headers.map(h => `<span class="badge bg-primary-subtle text-primary border me-1 mb-1">${h}</span>`).join('')}
          </div>
          <p class="small text-success mt-2 mb-0">Target schema columns and layout translation matrix generated!</p>
        `,
        confirmButtonColor: '#005eb8'
      });

    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'File Analysis Failed',
        text: err.message,
        confirmButtonColor: '#005eb8'
      });
    }
  }

  // =========================================================================
  // LIVE JSON PREVIEW & VALIDATION DIAGNOSTICS
  // =========================================================================

  renderJSONPreview() {
    const codeEl = document.getElementById('builder-json-code');
    if (!codeEl) return;
    const jsonStr = JSON.stringify(this.schema, null, 2);
    codeEl.textContent = jsonStr;
  }

  validateSchema() {
    const diagnosticsContainer = document.getElementById('builder-diagnostics');
    if (!diagnosticsContainer) return;

    const issues = [];
    const s = this.schema;

    if (!s.projectId || !/^[a-z0-9\-_]+$/i.test(s.projectId)) {
      issues.push("Project ID must be alphanumeric slug format (e.g. 'client-ingest-v1')");
    }
    if (!s.name) {
      issues.push("Project Display Name is required");
    }
    if (!s.targetColumns || s.targetColumns.length === 0) {
      issues.push("No target columns configured. Define at least one target column.");
    } else {
      const keys = s.targetColumns.map(c => c.key);
      const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (duplicates.length > 0) {
        issues.push(`Duplicate target column keys detected: ${[...new Set(duplicates)].join(', ')}`);
      }
    }

    if (!s.layouts || s.layouts.length === 0) {
      issues.push("At least one supplier layout profile must be defined.");
    } else {
      s.layouts.forEach((l, idx) => {
        if (!l.id) issues.push(`Layout profile #${idx + 1} is missing an ID.`);
        if (!l.name) issues.push(`Layout profile #${idx + 1} is missing a name.`);
      });
    }

    if (issues.length === 0) {
      diagnosticsContainer.innerHTML = `
        <div class="alert alert-success py-2 px-3 small d-flex align-items-center gap-2 mb-0">
          <i class="bi bi-shield-check fs-5 text-success"></i>
          <div><strong>Schema Valid:</strong> Ready for Unravel deployment & customer distribution.</div>
        </div>
      `;
    } else {
      diagnosticsContainer.innerHTML = `
        <div class="alert alert-warning py-2 px-3 small mb-0">
          <div class="fw-bold mb-1"><i class="bi bi-exclamation-triangle"></i> Schema Warnings (${issues.length}):</div>
          <ul class="mb-0 ps-3">
            ${issues.map(iss => `<li>${iss}</li>`).join('')}
          </ul>
        </div>
      `;
    }
  }

  downloadJSON() {
    const jsonStr = JSON.stringify(this.schema, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `${this.schema.projectId || 'customer'}-config.json`;
    link.download = fileName;
    link.click();
    this.showToast(`Downloaded ${fileName}`);
  }

  downloadSchema() {
    this.downloadJSON();
  }

  copyJsonToClipboard() {
    const str = JSON.stringify(this.schema, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(() => {
        this.showToast('JSON copied to clipboard!');
      }).catch(() => {
        Swal.fire({ title: 'JSON Schema', html: `<textarea class="form-control font-monospace small" rows="12">${str}</textarea>` });
      });
    } else {
      Swal.fire({ title: 'JSON Schema', html: `<textarea class="form-control font-monospace small" rows="12">${str}</textarea>` });
    }
  }

  importSchemaFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        this.schema = parsed;
        this.activeLayoutIndex = 0;
        this.renderAll();
        this.showToast('Imported config JSON successfully');
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Invalid JSON', text: err.message, confirmButtonColor: '#005eb8' });
      }
    };
    reader.readAsText(file);
  }

  launchInRunner() {
    const jsonStr = JSON.stringify(this.schema, null, 2);
    localStorage.setItem('unravel_active_project', jsonStr);

    Swal.fire({
      icon: 'success',
      title: 'Config Deployed to Local Vault!',
      text: 'Redirecting to Unravel runner with this schema loaded...',
      timer: 1500,
      showConfirmButton: false
    }).then(() => {
      window.location.href = '../index.html';
    });
  }

  showToast(msg) {
    Swal.fire({
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 2500,
      icon: 'success',
      title: msg
    });
  }
}

// Instantiate on DOM ready
let builder;
document.addEventListener('DOMContentLoaded', () => {
  builder = new UnravelBuilder();
  window.builder = builder;
  window.unravelBuilder = builder;
});
