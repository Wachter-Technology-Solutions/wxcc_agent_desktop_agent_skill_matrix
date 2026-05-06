import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

type SkillProfileRecord = {
  name?: string
  description?: string
  activeSkills?: Array<{
    skillName?: string
    name?: string
    skillValue?: string | number | boolean
    value?: string | number | boolean
  }>
  activeEnumSkills?: Array<{
    skillName?: string
    name?: string
    skillValues?: Array<string | number | boolean>
    values?: Array<string | number | boolean>
  }>
}

type SkillProfileResponse = {
  totalResources?: number
  pageNumber?: number
  pageSize?: number
  resources?: SkillProfileRecord[]
  items?: SkillProfileRecord[]
}

type MatrixRow = {
  name: string
  description: string
  skills: Record<string, string>
}

const DEFAULT_BASE_URL = 'https://api.wxcc-us1.cisco.com'
const DEFAULT_REFRESH_MS = 30000

@customElement('agent-skill-matrix-dashboard')
export class MyElement extends LitElement {
  @property() token = ''
  @property({ attribute: 'org-id' }) orgId = ''
  @property({ attribute: 'base-url' }) baseUrl = DEFAULT_BASE_URL
  @property({ attribute: 'refresh-ms', type: Number }) refreshMs =
    DEFAULT_REFRESH_MS
  @property({ attribute: 'darkmode' }) darkmode = 'false'

  @state() private loading = false
  @state() private error = ''
  @state() private rows: MatrixRow[] = []
  @state() private lastUpdated = ''
  @state() private apiRequestCount = 0
  @state() private searchTerm = ''
  @state() private skillFilters: string[] = []
  @state() private skillPickerOpen = false
  @state() private settingsOpen = false
  @state() private skillSearchTerm = ''
  @state() private hideEmptyColumns = true
  @state() private isTransposed = false
  @state() private autoRefreshEnabled = false
  @state() private darkModeEnabled = false

  private timerId?: number
  private boundWindowPointerDown = (event: PointerEvent) =>
    this.handleWindowPointerDown(event)

  connectedCallback() {
    super.connectedCallback()
    this.restoreSkillFilters()
    this.restoreHideEmptyColumns()
    this.restoreDarkModePreference()
    window.addEventListener('pointerdown', this.boundWindowPointerDown)
    this.loadData()
    this.startRefreshTimer()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('pointerdown', this.boundWindowPointerDown)
    if (this.timerId) {
      window.clearInterval(this.timerId)
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has('refreshMs') ||
      changedProperties.has('token') ||
      changedProperties.has('orgId') ||
      changedProperties.has('baseUrl') ||
      changedProperties.has('autoRefreshEnabled') ||
      changedProperties.has('skillFilters') ||
      changedProperties.has('hideEmptyColumns') ||
      changedProperties.has('darkmode') ||
      changedProperties.has('darkModeEnabled')
    ) {
      this.startRefreshTimer()
      if (
        changedProperties.has('token') ||
        changedProperties.has('orgId') ||
        changedProperties.has('baseUrl')
      ) {
        this.loadData()
      }
    }

    if (changedProperties.has('orgId')) {
      this.restoreSkillFilters()
      this.restoreHideEmptyColumns()
    }

    if (changedProperties.has('skillFilters')) {
      this.persistSkillFilters()
    }

    if (changedProperties.has('hideEmptyColumns')) {
      this.persistHideEmptyColumns()
    }

    if (changedProperties.has('darkmode')) {
      this.restoreDarkModePreference()
    }

    if (changedProperties.has('darkModeEnabled')) {
      this.persistDarkModePreference()
    }
  }

  private startRefreshTimer() {
    if (this.timerId) {
      window.clearInterval(this.timerId)
    }

    if (
      !this.autoRefreshEnabled ||
      !Number.isFinite(this.refreshMs) ||
      this.refreshMs <= 0
    ) {
      return
    }

    this.timerId = window.setInterval(() => this.loadData(), this.refreshMs)
  }

  private async loadData() {
    if (!this.token) {
      this.error = 'Missing access token.'
      this.rows = []
      return
    }

    if (!this.orgId) {
      this.error = 'Missing org ID.'
      this.rows = []
      return
    }

    this.loading = true
    this.error = ''

    try {
      const result = await this.fetchAllPages()
      const rows = this.flattenPayload(result)
        .map((record: SkillProfileRecord) => this.normalizeRecord(record))
        .sort((left: MatrixRow, right: MatrixRow) => left.name.localeCompare(right.name))

      this.rows = rows
      this.reconcileSkillFilters()
      this.lastUpdated = new Date().toLocaleTimeString()
    } catch (error) {
      this.rows = []
      this.error =
        error instanceof Error ? error.message : 'Unable to load skill profile data.'
    } finally {
      this.loading = false
    }
  }

  private async fetchSkillProfilePage(page: number, pageSize: number) {
    this.apiRequestCount += 1

    const url =
      `${this.baseUrl.replace(/\/$/, '')}/organization/${encodeURIComponent(this.orgId)}` +
      `/skill-profile/bulk-export?page=${page}&pageSize=${pageSize}`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json, */*',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Skill profile fetch failed with status ${response.status}: ${errorText || 'No response body'}`
      )
    }

    return (await response.json()) as SkillProfileResponse
  }

  private async fetchAllPages() {
    const firstPage = await this.fetchSkillProfilePage(0, 100)
    const pageSize = Number(firstPage.pageSize ?? 100)
    const totalResources = Number(
      firstPage.totalResources ??
        (Array.isArray(firstPage.resources) ? firstPage.resources.length : 0)
    )
    const totalPages = Math.max(1, Math.ceil(totalResources / pageSize))

    if (totalPages === 1) {
      return firstPage
    }

    const remainingPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        this.fetchSkillProfilePage(index + 1, pageSize)
      )
    )

    return {
      ...firstPage,
      resources: [
        ...(firstPage.resources ?? []),
        ...remainingPages.flatMap((page) => page.resources ?? []),
      ],
      totalResources,
      pageNumber: 0,
      pageSize,
    } satisfies SkillProfileResponse
  }

  private flattenPayload(
    payload: SkillProfileResponse | SkillProfileResponse[]
  ): SkillProfileRecord[] {
    if (Array.isArray(payload)) {
      return payload.flatMap((item) => this.flattenPayload(item))
    }

    if (Array.isArray(payload.resources)) {
      return payload.resources
    }

    if (Array.isArray(payload.items)) {
      return payload.items
    }

    return []
  }

  private normalizeSkillValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeSkillValue(item)).filter(Boolean).join(', ')
    }

    if (value === undefined || value === null) {
      return ''
    }

    return String(value).trim()
  }

  private normalizeRecord(record: SkillProfileRecord): MatrixRow {
    const skills: Record<string, string> = {}

    for (const skill of record.activeSkills ?? []) {
      const name = this.normalizeSkillValue(skill.skillName ?? skill.name)
      const value = this.normalizeSkillValue(skill.skillValue ?? skill.value)

      if (name) {
        skills[name] = value || 'true'
      }
    }

    for (const skill of record.activeEnumSkills ?? []) {
      const name = this.normalizeSkillValue(skill.skillName ?? skill.name)
      const value = this.normalizeSkillValue(skill.skillValues ?? skill.values ?? [])

      if (name) {
        skills[name] = value
      }
    }

    return {
      name: this.normalizeSkillValue(record.name) || '(unnamed profile)',
      description: this.normalizeSkillValue(record.description) || 'Unknown',
      skills,
    }
  }

  private get skillStorageKey() {
    return `wxcc-agent-skill-matrix:selected-skills:${this.orgId || 'default'}`
  }

  private get hideEmptyColumnsStorageKey() {
    return `wxcc-agent-skill-matrix:hide-empty-columns:${this.orgId || 'default'}`
  }

  private get darkModeStorageKey() {
    return `wxcc-agent-skill-matrix:dark-mode:${this.orgId || 'default'}`
  }

  private restoreSkillFilters() {
    try {
      const raw = window.localStorage.getItem(this.skillStorageKey)
      if (!raw) {
        this.skillFilters = []
        return
      }

      const parsed = JSON.parse(raw)
      this.skillFilters = Array.isArray(parsed)
        ? parsed
            .map((value) => this.normalizeSkillValue(value))
            .filter((value) => value.length > 0)
            .sort((left, right) =>
              left.localeCompare(right, undefined, { sensitivity: 'base' })
            )
        : []
    } catch {
      this.skillFilters = []
    }
  }

  private persistSkillFilters() {
    try {
      window.localStorage.setItem(
        this.skillStorageKey,
        JSON.stringify(this.skillFilters)
      )
    } catch {
      // Ignore storage failures so the widget still works in constrained environments.
    }
  }

  private restoreHideEmptyColumns() {
    try {
      const raw = window.localStorage.getItem(this.hideEmptyColumnsStorageKey)
      if (raw === null) {
        this.hideEmptyColumns = true
        return
      }

      this.hideEmptyColumns = raw === 'true'
    } catch {
      this.hideEmptyColumns = true
    }
  }

  private persistHideEmptyColumns() {
    try {
      window.localStorage.setItem(
        this.hideEmptyColumnsStorageKey,
        String(this.hideEmptyColumns)
      )
    } catch {
      // Ignore storage failures so the widget still works in constrained environments.
    }
  }

  private restoreDarkModePreference() {
    try {
      const raw = window.localStorage.getItem(this.darkModeStorageKey)
      if (raw === null) {
        this.darkModeEnabled = this.darkmode === 'true'
        return
      }

      this.darkModeEnabled = raw === 'true'
    } catch {
      this.darkModeEnabled = this.darkmode === 'true'
    }
  }

  private persistDarkModePreference() {
    try {
      window.localStorage.setItem(
        this.darkModeStorageKey,
        String(this.darkModeEnabled)
      )
    } catch {
      // Ignore storage failures so the widget still works in constrained environments.
    }
  }

  private reconcileSkillFilters() {
    const validSkills = new Set(this.getAllSkillColumns())
    const nextSkillFilters = this.skillFilters.filter((skill) => validSkills.has(skill))

    if (nextSkillFilters.length !== this.skillFilters.length) {
      this.skillFilters = nextSkillFilters
    }
  }

  private getAllSkillColumns() {
    const columns = new Set<string>()
    this.rows.forEach((row) => {
      Object.keys(row.skills).forEach((skill) => columns.add(skill))
    })
    return Array.from(columns).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' })
    )
  }

  private getFilteredRows() {
    const query = this.searchTerm.trim().toLowerCase()

    return this.rows.filter((row) => {
      const matchesSkill =
        this.skillFilters.length === 0 ||
        this.skillFilters.some(
          (skill) => this.normalizeSkillValue(row.skills[skill]).length > 0
        )
      const skillBlob = Object.entries(row.skills)
        .map(([name, value]) => `${name} ${value}`)
        .join(' ')
        .toLowerCase()
      const matchesSearch =
        !query ||
        `${row.name} ${row.description} ${skillBlob}`.toLowerCase().includes(query)

      return matchesSkill && matchesSearch
    })
  }

  private getVisibleColumns(filteredRows: MatrixRow[]) {
    let columns = this.getAllSkillColumns()

    if (this.skillFilters.length > 0) {
      columns = columns.filter((skill) => this.skillFilters.includes(skill))
    }

    if (this.hideEmptyColumns) {
      columns = columns.filter((skill) =>
        filteredRows.some((row) => this.normalizeSkillValue(row.skills[skill]).length > 0)
      )
    }

    return columns
  }

  private setSearchTerm(event: Event) {
    this.searchTerm = (event.target as HTMLInputElement).value
  }

  private toggleSkillFilterOption(skill: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked
    if (checked) {
      this.skillFilters = [...new Set([...this.skillFilters, skill])].sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: 'base' })
      )
      return
    }

    this.skillFilters = this.skillFilters.filter((value) => value !== skill)
  }

  private setSkillSearchTerm(event: Event) {
    this.skillSearchTerm = (event.target as HTMLInputElement).value
  }

  private toggleSkillPicker(event?: Event) {
    event?.stopPropagation()
    this.skillPickerOpen = !this.skillPickerOpen
    if (!this.skillPickerOpen) {
      this.skillSearchTerm = ''
    }
  }

  private closeSkillPicker() {
    this.skillPickerOpen = false
    this.skillSearchTerm = ''
  }

  private toggleSettings(event?: Event) {
    event?.stopPropagation()
    this.settingsOpen = !this.settingsOpen
  }

  private closeSettings() {
    this.settingsOpen = false
  }

  private handleWindowPointerDown(event: PointerEvent) {
    if (!this.skillPickerOpen && !this.settingsOpen) {
      return
    }

    const picker = this.renderRoot.querySelector('.skill-picker-shell')
    const settings = this.renderRoot.querySelector('.settings-shell')

    if (
      (picker && event.composedPath().includes(picker)) ||
      (settings && event.composedPath().includes(settings))
    ) {
      return
    }

    this.closeSkillPicker()
    this.closeSettings()
  }

  private getFilteredSkillOptions(skillOptions: string[]) {
    const query = this.skillSearchTerm.trim().toLowerCase()
    if (!query) {
      return skillOptions
    }

    return skillOptions.filter((skill) => skill.toLowerCase().includes(query))
  }

  private selectAllSkills(skillOptions: string[]) {
    this.skillFilters = [...skillOptions].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' })
    )
  }

  private clearAllSkills() {
    this.skillFilters = []
  }

  private toggleHideEmptyColumns(event: Event) {
    this.hideEmptyColumns = (event.target as HTMLInputElement).checked
  }

  private toggleAutoRefresh(event: Event) {
    this.autoRefreshEnabled = (event.target as HTMLInputElement).checked
  }

  private toggleDarkMode(event: Event) {
    this.darkModeEnabled = (event.target as HTMLInputElement).checked
  }

  private toggleTranspose() {
    this.isTransposed = !this.isTransposed
  }

  private getCellClass(value: string) {
    const normalized = value.trim().toLowerCase()
    if (!normalized) {
      return 'value empty'
    }

    if (normalized === 'true') {
      return 'value bool-true'
    }

    if (normalized === 'false') {
      return 'value bool-false'
    }

    return 'value'
  }

  private get themeClass() {
    return this.darkModeEnabled ? 'theme-dark' : 'theme-light'
  }

  render() {
    const filteredRows = this.getFilteredRows()
    const visibleColumns = this.getVisibleColumns(filteredRows)
    const skillOptions = this.getAllSkillColumns()
    const filteredSkillOptions = this.getFilteredSkillOptions(skillOptions)
    const syncMode = this.autoRefreshEnabled ? 'Auto refresh every 30 seconds' : 'Manual refresh only'
    const selectedSkillSummary =
      this.skillFilters.length === 0
        ? 'All skills'
        : `${this.skillFilters.length} selected`

    return html`
      <section class="table-shell ${this.themeClass}">
        <header class="topbar">
          <div class="title-group">
            <span class="title">Skill Matrix</span>
            <div class="stat-row">
              <span><strong>${this.rows.length}</strong> Profiles</span>
              <span><strong>${skillOptions.length}</strong> Unique Skills</span>
              <span><strong>${filteredRows.length}</strong> Rows Visible</span>
            </div>
          </div>
          <div class="topbar-actions">
            <div class="settings-shell">
              <button class="action-button secondary-button" @click=${this.toggleSettings}>
                Settings
              </button>
              ${this.settingsOpen
                ? html`
                    <div class="settings-popover">
                      <label class="settings-option">
                        <input
                          type="checkbox"
                          .checked=${this.hideEmptyColumns}
                          @change=${this.toggleHideEmptyColumns}
                        />
                        <span>Hide empty skill columns</span>
                      </label>
                      <label class="settings-option">
                        <input
                          type="checkbox"
                          .checked=${this.autoRefreshEnabled}
                          @change=${this.toggleAutoRefresh}
                        />
                        <span>Auto Refresh</span>
                      </label>
                      <label class="settings-option">
                        <input
                          type="checkbox"
                          .checked=${this.darkModeEnabled}
                          @change=${this.toggleDarkMode}
                        />
                        <span>Dark Mode</span>
                      </label>
                    </div>
                  `
                : null}
            </div>
            <button class="action-button primary-button" @click=${this.loadData} ?disabled=${this.loading}>
              ${this.loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button class="action-button secondary-button" @click=${this.toggleTranspose}>
              ${this.isTransposed ? 'Standard View' : 'Transpose View'}
            </button>
          </div>
        </header>

        <section class="filters-panel">
          <div class="filter-layout">
            <div class="filter-row">
              <input
                class="filter-input"
                type="search"
                .value=${this.searchTerm}
                @input=${this.setSearchTerm}
                placeholder="Profile, description, or skill"
              />
              <div class="skill-picker-shell">
                <div class="skill-picker-row">
                  <button
                    class="skill-picker-trigger"
                    @click=${this.toggleSkillPicker}
                    aria-expanded=${String(this.skillPickerOpen)}
                    aria-label="Open skill selection"
                  >
                    <span class="trigger-label">Skill Filter</span>
                    <span class="trigger-value">${selectedSkillSummary}</span>
                  </button>

                  <div class="selected-skill-chips">
                    ${this.skillFilters.length === 0
                      ? html`<span class="selected-skill-chip muted-chip">All skills</span>`
                      : this.skillFilters.slice(0, 3).map(
                          (skill) => html`<span class="selected-skill-chip">${skill}</span>`
                        )}
                    ${this.skillFilters.length > 3
                      ? html`
                          <span class="selected-skill-chip muted-chip">
                            +${this.skillFilters.length - 3} more
                          </span>
                        `
                      : null}
                  </div>
                </div>

                ${this.skillPickerOpen
                  ? html`
                      <div class="skill-picker-popover">
                        <div class="skill-picker-toolbar">
                          <input
                            class="skill-picker-search"
                            type="search"
                            .value=${this.skillSearchTerm}
                            @input=${this.setSkillSearchTerm}
                            placeholder="Search skills"
                          />
                          <div class="skill-picker-actions">
                            <button
                              class="mini-action"
                              @click=${() => this.selectAllSkills(filteredSkillOptions)}
                            >
                              Check all
                            </button>
                            <button class="mini-action" @click=${this.clearAllSkills}>
                              Clear all
                            </button>
                          </div>
                        </div>

                        <div class="skill-picker-list">
                          ${filteredSkillOptions.length === 0
                            ? html`
                                <div class="skill-picker-empty">
                                  No skills match "${this.skillSearchTerm.trim()}".
                                </div>
                              `
                            : filteredSkillOptions.map(
                                (skill) => html`
                                  <label class="skill-option">
                                    <input
                                      type="checkbox"
                                      .checked=${this.skillFilters.includes(skill)}
                                      @change=${(event: Event) =>
                                        this.toggleSkillFilterOption(skill, event)}
                                    />
                                    <span>${skill}</span>
                                  </label>
                                `
                              )}
                        </div>
                      </div>
                    `
                  : null}
              </div>
            </div>
          </div>
        </section>

        <div class="content-scroll">
          ${this.error
            ? html`<p class="status error">${this.error}</p>`
            : !this.rows.length
              ? html`<p class="status">Load data to render the skill matrix.</p>`
              : !filteredRows.length
                ? html`<p class="status">No rows match the current filter.</p>`
                : html`
                    <section class="matrix-card">
                      <div class="table-wrap matrix-shell">
                        ${this.isTransposed
                          ? html`
                              <table class="matrix-table">
                                <thead>
                                  <tr>
                                    <th class="sticky-head sticky-head-1">Skill</th>
                                    ${filteredRows.map(
                                      (row) => html`
                                        <th class="profile-head">
                                          <span class="profile-head-label">${row.name}</span>
                                        </th>
                                      `
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  ${visibleColumns.map((skill) => {
                                    return html`
                                      <tr>
                                        <td class="sticky-col sticky-col-1 skill-name-cell">
                                          ${skill}
                                        </td>
                                        ${filteredRows.map((row) => {
                                          const value = this.normalizeSkillValue(row.skills[skill])
                                          return html`
                                            <td>
                                              <span class=${this.getCellClass(value)}>
                                                ${value || '·'}
                                              </span>
                                            </td>
                                          `
                                        })}
                                      </tr>
                                    `
                                  })}
                                </tbody>
                              </table>
                            `
                          : html`
                              <table class="matrix-table">
                                <thead>
                                  <tr>
                                    <th class="sticky-head sticky-head-1">Profile</th>
                                    ${visibleColumns.map(
                                      (skill) => html`
                                        <th class="skill-head">
                                          <span class="skill-head-label">${skill}</span>
                                        </th>
                                      `
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  ${filteredRows.map(
                                    (row) => html`
                                      <tr>
                                        <td class="sticky-col sticky-col-1 name-cell">
                                          <span class="profile-name">${row.name}</span>
                                        </td>
                                        ${visibleColumns.map((skill) => {
                                          const value = this.normalizeSkillValue(row.skills[skill])
                                          return html`
                                            <td>
                                              <span class=${this.getCellClass(value)}>
                                                ${value || '·'}
                                              </span>
                                            </td>
                                          `
                                        })}
                                      </tr>
                                    `
                                  )}
                                </tbody>
                              </table>
                            `}
                      </div>

                      <footer class="matrix-footer">
                        <div class="footer-main">
                          <span>Last Synced: ${this.lastUpdated || 'Not yet loaded'}</span>
                          <span>Source: Skill Profile Bulk Export</span>
                        </div>
                        <div class="footer-status">
                          <span class="status-dot"></span>
                          ${syncMode}
                        </div>
                      </footer>
                    </section>
                  `}
        </div>
      </section>
    `
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    * {
      box-sizing: border-box;
    }

    .table-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: #f7f9fb;
      color: #2a3439;
      font-family: 'Inter', 'Segoe UI', sans-serif;
    }

    .theme-dark {
      background: #0f1720;
      color: #e6edf2;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 16px 24px;
      background: rgba(248, 250, 252, 0.94);
      border-bottom: 1px solid rgba(113, 124, 130, 0.14);
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(10px);
    }

    .title {
      display: block;
      font-family: 'Manrope', 'Segoe UI', sans-serif;
      font-size: 1.2rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    .stat-row {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      margin-top: 4px;
      font-size: 0.72rem;
      color: #687782;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .stat-row strong {
      color: #2a3439;
      font-weight: 800;
      margin-right: 4px;
    }

    .topbar-actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .settings-shell {
      position: relative;
    }

    .settings-popover {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      z-index: 20;
      min-width: 240px;
      padding: 12px;
      border-radius: 18px;
      background: #ffffff;
      box-shadow:
        0 18px 48px rgba(42, 52, 57, 0.14),
        inset 0 0 0 1px rgba(169, 180, 185, 0.2);
      display: grid;
      gap: 10px;
    }

    .settings-option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      cursor: pointer;
      color: #566166;
      font-size: 0.92rem;
      font-weight: 600;
    }

    .settings-option:hover {
      background: #e8eff3;
    }

    .settings-option input {
      width: 18px;
      height: 18px;
      accent-color: #006592;
      flex: 0 0 auto;
    }

    .action-button {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      transition: transform 120ms ease;
    }

    .action-button:hover {
      transform: translateY(-1px);
    }

    .action-button[disabled] {
      opacity: 0.7;
      cursor: wait;
    }

    .primary-button {
      background: #006592;
      color: #f5f9ff;
    }

    .secondary-button {
      background: #d3e4fe;
      color: #314055;
    }

    .filters-panel {
      padding: 24px;
    }

    .filter-layout {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .filter-row {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) auto auto;
      gap: 16px;
      align-items: start;
    }

    .filter-input {
      width: 100%;
      border: 0;
      border-radius: 16px;
      padding: 14px 16px;
      font: inherit;
      background: #ffffff;
      box-shadow: inset 0 0 0 1px rgba(169, 180, 185, 0.2);
      color: inherit;
    }

    .skill-selector {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: inset 0 0 0 1px rgba(169, 180, 185, 0.2);
      padding: 10px;
    }

    .skill-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      max-height: 172px;
      overflow: auto;
    }

    .skill-grid::-webkit-scrollbar,
    .table-wrap.matrix-shell::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    .skill-grid::-webkit-scrollbar-thumb,
    .table-wrap.matrix-shell::-webkit-scrollbar-thumb {
      background: #d9e4ea;
      border-radius: 999px;
    }

    .skill-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      cursor: pointer;
      transition: background-color 120ms ease;
    }

    .skill-option:hover {
      background: #e8eff3;
    }

    .skill-option input {
      width: 16px;
      height: 16px;
      accent-color: #006592;
      flex: 0 0 auto;
    }

    .skill-option span {
      font-size: 0.78rem;
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .skill-picker-shell {
      position: relative;
      min-width: 0;
    }

    .skill-picker-row {
      display: flex;
      gap: 0;
      align-items: center;
      flex-wrap: wrap;
    }

    .skill-picker-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 220px;
      border: 0;
      border-radius: 16px;
      padding: 14px 16px;
      background: #ffffff;
      box-shadow: inset 0 0 0 1px rgba(169, 180, 185, 0.2);
      font: inherit;
      color: inherit;
      cursor: pointer;
    }

    .trigger-label {
      font-weight: 800;
      font-size: 0.82rem;
      letter-spacing: 0.02em;
    }

    .trigger-value {
      font-size: 0.76rem;
      color: #687782;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .selected-skill-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      min-height: 28px;
    }

    .selected-skill-chip {
      display: inline-flex;
      align-items: center;
      max-width: 220px;
      padding: 8px 12px;
      border-radius: 999px;
      background: #d3e4fe;
      color: #314055;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .muted-chip {
      background: #e8eff3;
      color: #566166;
    }

    .skill-picker-popover {
      position: absolute;
      top: calc(100% + 12px);
      right: 0;
      z-index: 20;
      width: min(560px, calc(100vw - 48px));
      min-width: min(420px, calc(100vw - 48px));
      max-width: calc(100vw - 48px);
      background: #ffffff;
      border-radius: 20px;
      box-shadow:
        0 18px 48px rgba(42, 52, 57, 0.14),
        inset 0 0 0 1px rgba(169, 180, 185, 0.2);
      padding: 14px;
    }

    .skill-picker-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
    }

    .skill-picker-search {
      width: 100%;
      border: 0;
      border-radius: 14px;
      padding: 12px 14px;
      font: inherit;
      background: #f7f9fb;
      box-shadow: inset 0 0 0 1px rgba(169, 180, 185, 0.22);
      color: inherit;
    }

    .skill-picker-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .mini-action {
      border: 0;
      border-radius: 12px;
      padding: 10px 12px;
      background: #e8eff3;
      color: #314055;
      font: inherit;
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
    }

    .skill-picker-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 6px;
      max-height: 260px;
      overflow: auto;
      padding-right: 2px;
    }

    .skill-picker-list::-webkit-scrollbar,
    .table-wrap.matrix-shell::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    .skill-picker-list::-webkit-scrollbar-thumb,
    .table-wrap.matrix-shell::-webkit-scrollbar-thumb {
      background: #d9e4ea;
      border-radius: 999px;
    }

    .skill-picker-empty {
      padding: 18px 12px;
      font-size: 0.86rem;
      color: #687782;
      grid-column: 1 / -1;
    }

    .content-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      padding: 0 24px 24px;
      display: flex;
      flex-direction: column;
    }

    .status {
      padding: 18px;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: inset 0 0 0 1px rgba(169, 180, 185, 0.2);
    }

    .error {
      color: #9f403d;
    }

    .matrix-card {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 24px;
      background: #f0f4f7;
      box-shadow: inset 0 0 0 1px rgba(169, 180, 185, 0.14);
    }

    .matrix-shell {
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: auto;
      scrollbar-gutter: stable both-edges;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }

    .matrix-table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 14px 16px;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.6);
      border-right: 1px solid rgba(255, 255, 255, 0.45);
      vertical-align: top;
      font-size: 0.9rem;
      white-space: nowrap;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #dae2fd;
      vertical-align: bottom;
      font-family: 'Manrope', 'Segoe UI', sans-serif;
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #4a5167;
    }

    .sticky-head {
      z-index: 5;
    }

    .sticky-head-1,
    .sticky-col-1 {
      left: 0;
      min-width: 260px;
      max-width: 260px;
    }

    .sticky-col {
      position: sticky;
      z-index: 1;
      background: #f0f4f7;
    }

    .skill-head {
      height: 192px;
      min-width: 54px;
      width: 54px;
      padding: 12px 6px;
      text-align: center;
      vertical-align: bottom;
    }

    .skill-head-label {
      display: inline-block;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
      line-height: 1;
      padding-bottom: 6px;
    }

    .profile-head {
      min-width: 160px;
      max-width: 160px;
      white-space: normal;
      vertical-align: bottom;
    }

    .profile-head-label {
      display: inline-block;
      white-space: normal;
      line-height: 1.2;
    }

    .profile-name {
      font-size: 0.9rem;
      font-weight: 700;
      color: #2a3439;
      white-space: normal;
    }

    .skill-name-cell {
      white-space: normal;
      font-weight: 700;
    }

    .value {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 36px;
      min-height: 32px;
      padding: 4px 8px;
      border-radius: 10px;
      font-size: 0.76rem;
      font-weight: 700;
      background: rgba(0, 101, 146, 0.1);
      color: #006592;
    }

    .value.bool-true {
      background: rgba(0, 101, 146, 0.14);
      color: #006592;
    }

    .value.bool-false,
    .value.empty {
      background: #d9e4ea;
      color: #717c82;
    }

    tbody tr:nth-child(even) td {
      background: rgba(248, 250, 252, 0.38);
    }

    tbody tr:nth-child(even) .sticky-col {
      background: rgba(248, 250, 252, 0.38);
    }

    tbody tr:hover td,
    tbody tr:hover .sticky-col {
      background: #e1e9ee;
    }

    .matrix-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 12px 24px;
      background: #d9e4ea;
      color: #566166;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      flex-wrap: wrap;
    }

    .footer-main,
    .footer-status {
      display: flex;
      gap: 18px;
      align-items: center;
      flex-wrap: wrap;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #006592;
    }

    .theme-dark .topbar {
      background: rgba(15, 23, 32, 0.92);
      border-bottom-color: rgba(255, 255, 255, 0.08);
    }

    .theme-dark .title,
    .theme-dark .stat-row strong,
    .theme-dark .profile-name,
    .theme-dark .skill-option span {
      color: #f7f9fb;
    }

    .theme-dark .stat-row,
    .theme-dark .settings-option,
    .theme-dark .matrix-footer {
      color: #a9b4b9;
    }

    .theme-dark .primary-button {
      background: #34b5fa;
      color: #00121e;
    }

    .theme-dark .secondary-button {
      background: #1f2937;
      color: #dae2fd;
    }

    .theme-dark .filters-panel,
    .theme-dark .content-scroll {
      background: #0f1720;
    }

    .theme-dark .filter-input,
    .theme-dark .skill-selector,
    .theme-dark .settings-popover,
    .theme-dark .skill-picker-trigger,
    .theme-dark .skill-picker-popover,
    .theme-dark .skill-picker-search,
    .theme-dark .status,
    .theme-dark .matrix-card {
      background: #111b24;
      color: #f7f9fb;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }

    .theme-dark .trigger-value,
    .theme-dark .skill-picker-empty {
      color: #a9b4b9;
    }

    .theme-dark .selected-skill-chip {
      background: #314055;
      color: #f7f9fb;
    }

    .theme-dark .muted-chip,
    .theme-dark .mini-action {
      background: #1f2937;
      color: #dae2fd;
    }

    .theme-dark .skill-option:hover {
      background: #1b2732;
    }

    .theme-dark .settings-option:hover {
      background: #1b2732;
    }

    .theme-dark th {
      background: #1f3243;
      color: #ccd4ee;
    }

    .theme-dark td,
    .theme-dark th {
      border-bottom-color: rgba(255, 255, 255, 0.08);
      border-right-color: rgba(255, 255, 255, 0.06);
    }

    .theme-dark .sticky-col,
    .theme-dark tbody tr:nth-child(even) .sticky-col {
      background: #111b24;
    }

    .theme-dark tbody tr:nth-child(even) td {
      background: rgba(17, 27, 36, 0.85);
    }

    .theme-dark tbody tr:hover td,
    .theme-dark tbody tr:hover .sticky-col {
      background: #1b2732;
    }

    .theme-dark .value {
      background: rgba(52, 181, 250, 0.16);
      color: #34b5fa;
    }

    .theme-dark .value.bool-false,
    .theme-dark .value.empty {
      background: #25303a;
      color: #a9b4b9;
    }

    .theme-dark .status-dot {
      background: #34b5fa;
    }

    .theme-dark .error {
      color: #fe8983;
    }

    @media (max-width: 1100px) {
      .filter-row {
        grid-template-columns: 1fr;
      }

      .skill-picker-shell {
        width: 100%;
      }

      .skill-picker-popover {
        left: 0;
        right: auto;
        width: min(100%, calc(100vw - 32px));
        min-width: 0;
        max-width: min(100%, calc(100vw - 32px));
      }
    }

    @media (max-width: 720px) {
      .topbar,
      .filters-panel,
      .content-scroll {
        padding-left: 16px;
        padding-right: 16px;
      }

      .topbar {
        flex-direction: column;
        align-items: flex-start;
      }

      .topbar-actions {
        width: 100%;
      }

      .skill-grid {
        grid-template-columns: 1fr;
      }

      .skill-picker-toolbar,
      .skill-picker-list {
        grid-template-columns: 1fr;
      }

      .sticky-col,
      .sticky-head {
        position: static;
      }

      .matrix-table {
        min-width: 980px;
      }
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-skill-matrix-dashboard': MyElement
  }
}
