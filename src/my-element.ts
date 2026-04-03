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
  @state() private descriptionFilter = 'all'
  @state() private skillFilters: string[] = []
  @state() private hideEmptyColumns = false
  @state() private isTransposed = false
  @state() private autoRefreshEnabled = false

  private timerId?: number

  connectedCallback() {
    super.connectedCallback()
    this.loadData()
    this.startRefreshTimer()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
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
      changedProperties.has('autoRefreshEnabled')
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
      this.apiRequestCount += 1

      const url = `${this.baseUrl.replace(/\/$/, '')}/organization/${encodeURIComponent(this.orgId)}/skill-profile/bulk-export?page=0&pageSize=100`
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

      const result = (await response.json()) as SkillProfileResponse | SkillProfileResponse[]
      const rows = this.flattenPayload(result)
        .map((record: SkillProfileRecord) => this.normalizeRecord(record))
        .sort((left: MatrixRow, right: MatrixRow) => left.name.localeCompare(right.name))

      this.rows = rows
      this.lastUpdated = new Date().toLocaleTimeString()
    } catch (error) {
      this.rows = []
      this.error =
        error instanceof Error ? error.message : 'Unable to load skill profile data.'
    } finally {
      this.loading = false
    }
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

  private getAllSkillColumns() {
    const columns = new Set<string>()
    this.rows.forEach((row) => {
      Object.keys(row.skills).forEach((skill) => columns.add(skill))
    })
    return Array.from(columns).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' })
    )
  }

  private getDescriptionOptions() {
    return [...new Set(this.rows.map((row) => row.description))]
      .filter((value) => value.length > 0)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  }

  private getFilteredRows() {
    const query = this.searchTerm.trim().toLowerCase()

    return this.rows.filter((row) => {
      const matchesDescription =
        this.descriptionFilter === 'all' || row.description === this.descriptionFilter
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

      return matchesDescription && matchesSkill && matchesSearch
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

  private getFilledCount(filteredRows: MatrixRow[]) {
    return filteredRows.reduce((sum, row) => sum + Object.keys(row.skills).length, 0)
  }

  private setSearchTerm(event: Event) {
    this.searchTerm = (event.target as HTMLInputElement).value
  }

  private setDescriptionFilter(event: Event) {
    this.descriptionFilter = (event.target as HTMLSelectElement).value
  }

  private setSkillFilter(event: Event) {
    const target = event.target as HTMLSelectElement
    this.skillFilters = Array.from(target.selectedOptions).map((option) => option.value)
  }

  private toggleHideEmptyColumns(event: Event) {
    this.hideEmptyColumns = (event.target as HTMLInputElement).checked
  }

  private toggleAutoRefresh(event: Event) {
    this.autoRefreshEnabled = (event.target as HTMLInputElement).checked
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
    return this.darkmode === 'true' ? 'theme-dark' : 'theme-light'
  }

  render() {
    const filteredRows = this.getFilteredRows()
    const visibleColumns = this.getVisibleColumns(filteredRows)
    const descriptionOptions = this.getDescriptionOptions()
    const skillOptions = this.getAllSkillColumns()

    return html`
      <section class="table-shell ${this.themeClass}">
        <div class="toolbar">
          <button class="refresh" @click=${this.loadData} ?disabled=${this.loading}>
            ${this.loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button class="refresh secondary-button" @click=${this.toggleTranspose}>
            ${this.isTransposed ? 'Standard View' : 'Transpose View'}
          </button>
          <div class="meta">
            <span>${this.rows.length} profiles</span>
            <span>${skillOptions.length} unique skills</span>
            <span>${filteredRows.length} visible rows</span>
            <span>${this.getFilledCount(filteredRows)} filled cells</span>
            <span>${this.apiRequestCount} API requests</span>
            <span>Updated: ${this.lastUpdated || 'Not yet loaded'}</span>
          </div>
        </div>

        <div class="table-wrap controls-wrap">
          <div class="section-header">
            <div class="section-title">Filters</div>
            <div class="filters">
              <label class="filter-label wide-filter">
                Search
                <input
                  class="filter-input"
                  type="search"
                  .value=${this.searchTerm}
                  @input=${this.setSearchTerm}
                  placeholder="Profile, description, or skill"
                />
              </label>

              <label class="filter-label">
                Description
                <select class="filter-select" @change=${this.setDescriptionFilter}>
                  <option value="all" ?selected=${this.descriptionFilter === 'all'}>
                    All
                  </option>
                  ${descriptionOptions.map(
                    (description) => html`
                      <option
                        value=${description}
                        ?selected=${this.descriptionFilter === description}
                      >
                        ${description}
                      </option>
                    `
                  )}
                </select>
              </label>

              <label class="filter-label">
                Skills
                <select class="filter-select multi-select" multiple @change=${this.setSkillFilter}>
                  ${skillOptions.map(
                    (skill) => html`
                      <option value=${skill} ?selected=${this.skillFilters.includes(skill)}>
                        ${skill}
                      </option>
                    `
                  )}
                </select>
                <span class="filter-help">
                  Multi-select: hold Cmd on Mac or Ctrl on Windows while clicking. Use Shift
                  to select a range.
                </span>
              </label>

              <label class="toggle">
                <input
                  type="checkbox"
                  .checked=${this.autoRefreshEnabled}
                  @change=${this.toggleAutoRefresh}
                />
                Auto refresh every 30 seconds
              </label>

              <label class="toggle">
                <input
                  type="checkbox"
                  .checked=${this.hideEmptyColumns}
                  @change=${this.toggleHideEmptyColumns}
                />
                Hide empty skill columns
              </label>
            </div>
          </div>
        </div>

        <div class="content-scroll">
          ${this.error
            ? html`<p class="status error">${this.error}</p>`
            : !this.rows.length
              ? html`<p class="status">Load data to render the skill matrix.</p>`
              : !filteredRows.length
                ? html`<p class="status">No rows match the current filter.</p>`
                : html`
                    <div class="table-wrap matrix-shell">
                      ${this.isTransposed
                        ? html`
                            <table class="matrix-table">
                              <thead>
                                <tr>
                                  <th class="sticky-head sticky-head-1">Skill</th>
                                  <th>Profiles With Skill</th>
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
                                  const profilesWithSkill = filteredRows.filter(
                                    (row) =>
                                      this.normalizeSkillValue(row.skills[skill]).length > 0
                                  ).length

                                  return html`
                                    <tr>
                                      <td class="sticky-col sticky-col-1 skill-name-cell">
                                        ${skill}
                                      </td>
                                      <td class="count-cell">${profilesWithSkill}</td>
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
                                  <th class="sticky-head sticky-head-2">Description</th>
                                  <th>Skill Count</th>
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
                                        ${row.name}
                                      </td>
                                      <td class="sticky-col sticky-col-2 desc-cell">
                                        ${row.description}
                                      </td>
                                      <td class="count-cell">${Object.keys(row.skills).length}</td>
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
                      <div class="section-title section-title-bottom">Skill Matrix</div>
                    </div>
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
      padding: 12px;
      font-family:
        'Segoe UI',
        -apple-system,
        BlinkMacSystemFont,
        sans-serif;
      color: #102a43;
      background: #f4f7fb;
    }

    .theme-dark {
      color: #f0f4f8;
      background: #08131f;
    }

    .toolbar {
      flex: 0 0 auto;
      display: flex;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .meta {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      font-size: 0.9rem;
    }

    .refresh {
      border: 0;
      border-radius: 8px;
      padding: 8px 14px;
      font: inherit;
      font-weight: 700;
      color: white;
      background: #0f62fe;
      cursor: pointer;
    }

    .refresh[disabled] {
      opacity: 0.7;
      cursor: wait;
    }

    .secondary-button {
      background: #d9e8ff;
      color: #102a43;
    }

    .status,
    .table-wrap {
      border: 1px solid rgba(16, 42, 67, 0.1);
      border-radius: 10px;
      background: white;
    }

    .controls-wrap {
      flex: 0 0 auto;
      padding: 0 12px 12px;
      margin-bottom: 12px;
    }

    .content-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }

    .status {
      padding: 14px 16px;
    }

    .error {
      color: #b42318;
    }

    .section-title {
      padding: 12px 12px 0;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .section-title-bottom {
      padding: 12px;
    }

    .section-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding-top: 12px;
    }

    .filters {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: end;
    }

    .filter-label {
      display: grid;
      gap: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #334e68;
    }

    .filter-help {
      max-width: 240px;
      font-size: 0.74rem;
      font-weight: 500;
      line-height: 1.35;
      color: #627d98;
    }

    .wide-filter {
      min-width: min(320px, 100%);
    }

    .filter-select,
    .filter-input {
      border: 1px solid #bcccdc;
      border-radius: 6px;
      background: white;
      color: inherit;
      font: inherit;
      padding: 8px 10px;
    }

    .multi-select {
      min-width: 220px;
      min-height: 120px;
    }

    .toggle {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 0.85rem;
      font-weight: 600;
      color: #486581;
    }

    .matrix-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      margin-bottom: 12px;
    }

    .matrix-shell table {
      flex: 0 0 auto;
    }

    .matrix-table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
    }

    .table-wrap.matrix-shell {
      overflow: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }

    th,
    td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid #d9e2ec;
      border-right: 1px solid rgba(217, 226, 236, 0.6);
      vertical-align: top;
      font-size: 0.9rem;
      white-space: nowrap;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #eaf1fb;
      vertical-align: bottom;
      font-size: 0.78rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .sticky-head {
      z-index: 5;
    }

    .sticky-head-1,
    .sticky-col-1 {
      left: 0;
      min-width: 250px;
      max-width: 250px;
    }

    .sticky-head-2,
    .sticky-col-2 {
      left: 250px;
      min-width: 190px;
      max-width: 190px;
    }

    .sticky-col {
      position: sticky;
      z-index: 1;
      background: #fff;
    }

    .skill-head {
      height: 220px;
      min-width: 54px;
      width: 54px;
      padding: 10px 6px;
      text-align: center;
      vertical-align: bottom;
    }

    .skill-head-label {
      display: inline-block;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
      line-height: 1;
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

    .name-cell {
      white-space: normal;
      font-weight: 700;
    }

    .skill-name-cell {
      white-space: normal;
      font-weight: 700;
      min-width: 250px;
      max-width: 250px;
    }

    .desc-cell {
      white-space: normal;
      color: #486581;
    }

    .count-cell {
      text-align: center;
      font-weight: 700;
      color: #243b53;
    }

    .value {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 28px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 700;
      background: #deebff;
      color: #0f62fe;
    }

    .value.bool-true {
      background: #e3fcef;
      color: #046c4e;
    }

    .value.bool-false {
      background: #fde8e8;
      color: #c81e1e;
    }

    .value.empty {
      background: transparent;
      color: #9fb3c8;
      border: 1px dashed rgba(16, 42, 67, 0.18);
    }

    tbody tr:nth-child(even) td {
      background: #f8fbff;
    }

    tbody tr:nth-child(even) .sticky-col {
      background: #f8fbff;
    }

    tbody tr:hover td {
      background: #eef6ff;
    }

    tbody tr:hover .sticky-col {
      background: #eef6ff;
    }

    .theme-dark .status,
    .theme-dark .table-wrap {
      background: #102a43;
      border-color: rgba(255, 255, 255, 0.12);
    }

    .theme-dark .filter-label,
    .theme-dark .filter-help,
    .theme-dark .toggle {
      color: #d9e2ec;
    }

    .theme-dark .error {
      color: #fda29b;
    }

    .theme-dark th {
      background: #16324f;
    }

    .theme-dark td,
    .theme-dark th {
      border-bottom-color: rgba(255, 255, 255, 0.1);
      border-right-color: rgba(255, 255, 255, 0.08);
    }

    .theme-dark .sticky-col {
      background: #102a43;
    }

    .theme-dark tbody tr:nth-child(even) td,
    .theme-dark tbody tr:nth-child(even) .sticky-col {
      background: #132f4c;
    }

    .theme-dark tbody tr:hover td,
    .theme-dark tbody tr:hover .sticky-col {
      background: #173752;
    }

    .theme-dark .filter-select,
    .theme-dark .filter-input {
      background: #16324f;
      border-color: rgba(255, 255, 255, 0.16);
      color: inherit;
    }

    .theme-dark .secondary-button {
      background: #16324f;
      color: #d9e2ec;
    }

    .theme-dark .value {
      background: #1d4f91;
      color: #dbeafe;
    }

    .theme-dark .value.bool-true {
      background: #0f5132;
      color: #d1fae5;
    }

    .theme-dark .value.bool-false {
      background: #7f1d1d;
      color: #fee2e2;
    }

    .theme-dark .value.empty {
      color: #9fb3c8;
      border-color: rgba(255, 255, 255, 0.2);
    }

    @media (max-width: 720px) {
      .table-shell {
        min-height: auto;
        padding: 8px;
      }

      .toolbar {
        flex-direction: column;
        align-items: flex-start;
      }

      .section-header {
        flex-direction: column;
      }

      .sticky-col,
      .sticky-head {
        position: static;
      }

      .matrix-table {
        min-width: 900px;
      }
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-skill-matrix-dashboard': MyElement
  }
}
