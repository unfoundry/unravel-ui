# Unravel UI

Unravel Engine UI — Zero-Trust, Client-Side Tabular Data Ingestion, Rule Validation, and Schema Normalizer.

---

## ⚡ Highlights

- **100% Client-Side RAM Execution**: Spreadsheet parsing, layout matching, cell validations, calculations, and normalizations execute strictly inside browser memory.
- **Progressive Web App (PWA)**: Complete offline and air-gapped readiness with local service worker caching and encrypted Web Crypto vault.
- **Developer Studio (`/builder/`)**: Interactive schema authoring tool with drag-and-drop auto-scaffolding, virtual formula fields, and ingestion row filters.
- **Zero Third-Party CDNs**: All JS/CSS dependencies (Bootstrap, SheetJS, PapaParse, SweetAlert2, Moment.js) are self-contained locally.

---

## 🚀 Running Locally

Because Unravel UI is 100% static HTML5/JavaScript, it can be served using any static web server:

### Python HTTP Server
```bash
python3 -m http.server 3000
```
Open `http://localhost:3000` in your web browser.

### Node `npx serve`
```bash
npx serve .
```

### Nginx / Production
Deploy the repository root directly into `/usr/share/nginx/html` or your web server root.
