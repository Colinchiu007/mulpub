// @ts-check
/**
 * store-schema — Store 的 SQL schema 定义 + 帮助函数
 * 从 store.js 提取，可独立测试。
 */

const TABLE_NAMES = {
  accounts: "accounts",
  publish_history: "publish_history",
  scheduled_tasks: "scheduled_tasks",
  settings: "settings",
  callback_logs: "callback_logs",
  batch_jobs: "batch_jobs",
  publish_timeline: "publish_timeline",
  model_providers: "model_providers",
  model_provider_logs: "model_provider_logs",
  backlot_projects: "backlot_projects",
};

const LEGACY_OWNER_SUBJECT = "__legacy__";

const OWNER_TABLE_SCHEMA_SQL = {
  accounts: `CREATE TABLE IF NOT EXISTS accounts (
    owner_subject TEXT NOT NULL,
    id            TEXT NOT NULL,
    platform      TEXT NOT NULL,
    account_name  TEXT,
    name          TEXT,
    avatar        TEXT,
    cookies       TEXT DEFAULT "[]",
    localStorage  TEXT DEFAULT "{}",
    cookies_enc   BLOB,
    localStorage_enc BLOB,
    avatar_url    TEXT,
    status        TEXT DEFAULT "active",
    last_validated TEXT,
    is_default    INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT '',
    updated_at    TEXT DEFAULT '',
    PRIMARY KEY (owner_subject, id)
  )`,
  publish_history: `CREATE TABLE IF NOT EXISTS publish_history (
    owner_subject TEXT NOT NULL,
    id            TEXT NOT NULL,
    platform      TEXT NOT NULL,
    article_id    TEXT,
    title         TEXT,
    content       TEXT,
    task_id       TEXT DEFAULT '',
    status        TEXT DEFAULT "pending",
    result        TEXT DEFAULT "{}",
    error         TEXT DEFAULT '',
    rewrite_history_id TEXT,
    created_at    TEXT DEFAULT '',
    PRIMARY KEY (owner_subject, id)
  )`,
  scheduled_tasks: `CREATE TABLE IF NOT EXISTS scheduled_tasks (
    owner_subject TEXT NOT NULL,
    id            TEXT NOT NULL,
    platform      TEXT NOT NULL,
    article       TEXT DEFAULT "{}",
    publish_time  TEXT,
    status        TEXT DEFAULT "pending",
    created_at    TEXT DEFAULT '',
    PRIMARY KEY (owner_subject, id)
  )`,
  batch_jobs: `CREATE TABLE IF NOT EXISTS batch_jobs (
    owner_subject TEXT NOT NULL,
    id            TEXT NOT NULL,
    name          TEXT,
    articles      TEXT DEFAULT "[]",
    total         INTEGER DEFAULT 0,
    completed     INTEGER DEFAULT 0,
    failed        INTEGER DEFAULT 0,
    status        TEXT DEFAULT "pending",
    created_at    TEXT DEFAULT '',
    PRIMARY KEY (owner_subject, id)
  )`,
  publish_timeline: `CREATE TABLE IF NOT EXISTS publish_timeline (
    owner_subject  TEXT NOT NULL,
    key            TEXT NOT NULL,
    last_publish_at TEXT,
    PRIMARY KEY (owner_subject, key)
  )`,
};

const OWNER_INDEX_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_accounts_owner_platform ON accounts(owner_subject, platform)`,
  `CREATE INDEX IF NOT EXISTS idx_history_owner_platform ON publish_history(owner_subject, platform)`,
  `CREATE INDEX IF NOT EXISTS idx_history_owner_created ON publish_history(owner_subject, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_owner_time ON scheduled_tasks(owner_subject, publish_time)`,
  `CREATE INDEX IF NOT EXISTS idx_batch_owner_created ON batch_jobs(owner_subject, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_timeline_owner_key ON publish_timeline(owner_subject, key)`,
];

const SCHEMA_SQL = [
  OWNER_TABLE_SCHEMA_SQL.accounts,
  OWNER_TABLE_SCHEMA_SQL.publish_history,
  OWNER_TABLE_SCHEMA_SQL.scheduled_tasks,
  OWNER_TABLE_SCHEMA_SQL.batch_jobs,
  OWNER_TABLE_SCHEMA_SQL.publish_timeline,
  `CREATE TABLE IF NOT EXISTS settings (
    key           TEXT PRIMARY KEY,
    value         TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS callback_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT NOT NULL,
    source        TEXT DEFAULT "",
    payload       TEXT DEFAULT "{}",
    created_at    TEXT DEFAULT ''
  )`,
  // owner 索引由 migrateOwnerIsolationSchema 在旧表重建后统一创建，
  // 避免升级旧库时先引用尚不存在的 owner_subject 列。
  `CREATE INDEX IF NOT EXISTS idx_callback_created ON callback_logs(created_at)`,
  `CREATE TABLE IF NOT EXISTS model_providers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,
    base_url      TEXT DEFAULT '',
    api_key       TEXT DEFAULT '',
    api_key_enc   BLOB,
    models        TEXT DEFAULT '[]',
    enabled       INTEGER DEFAULT 0,
    is_default    INTEGER DEFAULT 0,
    is_preset     INTEGER DEFAULT 0,
    config        TEXT DEFAULT '{}',
    created_at    TEXT DEFAULT '',
    updated_at    TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_providers_category ON model_providers(category)`,
  // ─── Phase 2+：模型供应商调用日志表 ───
  `CREATE TABLE IF NOT EXISTS model_provider_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id   TEXT NOT NULL,
    category      TEXT NOT NULL,
    model         TEXT,
    action        TEXT NOT NULL,
    status        TEXT NOT NULL,
    latency_ms    INTEGER,
    tokens_in     INTEGER,
    tokens_out    INTEGER,
    cost          REAL,
    error_message TEXT,
    created_at    TEXT DEFAULT '',
    FOREIGN KEY (provider_id) REFERENCES model_providers(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_provider_logs_provider ON model_provider_logs(provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_model_provider_logs_created ON model_provider_logs(created_at)`,
  // ─── Backlot 项目库（OpenMontage 集成） ───
  `CREATE TABLE IF NOT EXISTS backlot_projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    pipeline_type TEXT NOT NULL,
    status        TEXT DEFAULT 'draft',
    summary       TEXT DEFAULT '',
    thumbnail_path TEXT,
    total_cost    REAL DEFAULT 0,
    last_run_at   TEXT,
    stages        TEXT DEFAULT '[]',
    metadata      TEXT DEFAULT '{}',
    created_at    TEXT DEFAULT '',
    updated_at    TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_backlot_projects_updated ON backlot_projects(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_backlot_projects_status ON backlot_projects(status)`,
  // ─── 知识库：爆款库（采集/手动添加的爆款内容）───
  `CREATE TABLE IF NOT EXISTS viral_library (
    id                  TEXT PRIMARY KEY,
    title               TEXT DEFAULT '',
    cover_url           TEXT DEFAULT '',
    author              TEXT DEFAULT '',
    url                 TEXT DEFAULT '',
    content             TEXT NOT NULL,
    tags                TEXT DEFAULT '[]',
    likes               INTEGER DEFAULT 0,
    collections         INTEGER DEFAULT 0,
    comments            INTEGER DEFAULT 0,
    like_collect_ratio  REAL DEFAULT 0,
    published_at        TEXT DEFAULT '',
    platform            TEXT DEFAULT '',
    source              TEXT DEFAULT 'manual',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_viral_library_created ON viral_library(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_viral_library_platform ON viral_library(platform)`,
  // ─── 知识库：个人知识库（IP 人设/背景/经历/观点）───
  `CREATE TABLE IF NOT EXISTS personal_knowledge (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL,
    title       TEXT DEFAULT '',
    content     TEXT NOT NULL,
    source_file TEXT DEFAULT '',
    file_type   TEXT DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_personal_knowledge_created ON personal_knowledge(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_personal_knowledge_category ON personal_knowledge(category)`,
];

function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== "string") return fallback;
  // eslint-disable-next-line no-unused-vars
  try { return JSON.parse(str); } catch (e) { return fallback || str; }
}

function safeJsonStringify(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildUpdateQuery(fields, jsonKeys = ["articles"]) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(jsonKeys.includes(k) ? JSON.stringify(v) : v);
  }
  return { sets, vals };
}

/**
 * 各表允许更新的字段白名单（防止 SQL 注入：字段名直接拼接进 SQL）
 * 仅允许这些字段名出现在 UPDATE 的 SET 子句中
 */
const UPDATE_WHITELIST = {
  accounts: ["platform", "name", "account_name", "avatar", "avatar_url", "status", "is_default", "last_validated"],
  publish_history: ["platform", "title", "content", "task_id", "article_id", "status", "result", "error"],
  scheduled_tasks: ["platform", "article", "publish_time", "status"],
  settings: ["value"],
  callback_logs: ["type", "source", "payload"],
  batch_jobs: ["name", "articles", "total", "completed", "failed", "status"],
  publish_timeline: ["last_publish_at"],
  model_providers: ["name", "base_url", "api_key", "api_key_enc", "models", "enabled", "is_default", "config", "updated_at"],
  backlot_projects: ["name", "pipeline_type", "status", "summary", "thumbnail_path", "total_cost", "last_run_at", "stages", "metadata", "updated_at"],
};

/**
 * 过滤更新字段，只保留白名单中的字段名（SQL 注入防护）
 * @param {string} tableName - 表名（必须是 UPDATE_WHITELIST 的 key）
 * @param {object} fields - 待更新的字段对象
 * @returns {object} 过滤后的字段对象（只含白名单字段）
 */
function sanitizeUpdateFields(tableName, fields) {
  const allowed = UPDATE_WHITELIST[tableName];
  if (!allowed || !fields || typeof fields !== "object") return {};
  const result = {};
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) {
      result[k] = fields[k];
    }
  }
  return result;
}

const OWNER_TABLE_COLUMNS = {
  accounts: ["owner_subject", "id", "platform", "account_name", "name", "avatar", "cookies", "localStorage", "cookies_enc", "localStorage_enc", "avatar_url", "status", "last_validated", "is_default", "created_at", "updated_at"],
  publish_history: ["owner_subject", "id", "platform", "article_id", "title", "content", "task_id", "status", "result", "error", "created_at"],
  scheduled_tasks: ["owner_subject", "id", "platform", "article", "publish_time", "status", "created_at"],
  batch_jobs: ["owner_subject", "id", "name", "articles", "total", "completed", "failed", "status", "created_at"],
  publish_timeline: ["owner_subject", "key", "last_publish_at"],
};

const OWNER_TABLE_KEY_COLUMNS = {
  accounts: "id",
  publish_history: "id",
  scheduled_tasks: "id",
  batch_jobs: "id",
  publish_timeline: "key",
};

const OWNER_COLUMN_DEFAULTS = {
  account_name: "''",
  name: "''",
  avatar: "''",
  cookies: "'[]'",
  localStorage: "'{}'",
  cookies_enc: "NULL",
  localStorage_enc: "NULL",
  avatar_url: "NULL",
  status: "'pending'",
  is_default: "0",
  created_at: "''",
  updated_at: "''",
  article_id: "''",
  title: "''",
  content: "''",
  task_id: "''",
  result: "'{}'",
  error: "''",
  article: "'{}'",
  publish_time: "''",
  articles: "'[]'",
  total: "0",
  completed: "0",
  failed: "0",
  last_publish_at: "NULL",
};

function execSchemaSql(db, sql) {
  if (typeof db.execOrThrow === "function") return db.execOrThrow(sql);
  return db.exec(sql);
}

function getTableInfo(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function needsOwnerTableRebuild(tableName, columns) {
  if (columns.length === 0) return false;
  const names = new Set(columns.map((column) => column.name));
  const primaryKey = columns
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => column.name);
  const keyColumn = OWNER_TABLE_KEY_COLUMNS[tableName];
  return OWNER_TABLE_COLUMNS[tableName].some((column) => !names.has(column)) ||
    primaryKey.length !== 2 || primaryKey[0] !== "owner_subject" || primaryKey[1] !== keyColumn;
}

function migrationSelectExpression(tableName, column, oldColumns) {
  if (column === "owner_subject") {
    if (!oldColumns.has(column)) return `'${LEGACY_OWNER_SUBJECT}'`;
    return `COALESCE(NULLIF(TRIM(CAST(owner_subject AS TEXT)), ''), '${LEGACY_OWNER_SUBJECT}')`;
  }
  if (column === "id" || column === "key") {
    return oldColumns.has(column)
      ? `COALESCE(CAST(${column} AS TEXT), 'legacy-' || rowid)`
      : `'legacy-' || rowid`;
  }
  if (oldColumns.has(column)) return column;
  if (column === "status" && tableName === "accounts") return "'active'";
  return OWNER_COLUMN_DEFAULTS[column] || "NULL";
}

function rebuildOwnerTable(db, tableName, columns) {
  const oldTableName = `${tableName}__owner_migration_v1`;
  const oldColumns = new Set(columns.map((column) => column.name));
  const targetColumns = OWNER_TABLE_COLUMNS[tableName];
  const selectExpressions = targetColumns.map((column) => migrationSelectExpression(tableName, column, oldColumns));

  execSchemaSql(db, `ALTER TABLE ${tableName} RENAME TO ${oldTableName}`);
  execSchemaSql(db, OWNER_TABLE_SCHEMA_SQL[tableName]);
  execSchemaSql(db, `INSERT INTO ${tableName} (${targetColumns.join(", ")}) SELECT ${selectExpressions.join(", ")} FROM ${oldTableName}`);
  execSchemaSql(db, `DROP TABLE ${oldTableName}`);
}

/**
 * 将本地用户数据表迁移为 owner_subject + id 复合主键。
 * 无归属的历史数据只进入 legacy 命名空间，登录用户不会隐式继承。
 */
function migrateOwnerIsolationSchema(db) {
  const migrate = () => {
    for (const tableName of Object.keys(OWNER_TABLE_SCHEMA_SQL)) {
      const columns = getTableInfo(db, tableName);
      if (columns.length === 0) {
        execSchemaSql(db, OWNER_TABLE_SCHEMA_SQL[tableName]);
      } else if (needsOwnerTableRebuild(tableName, columns)) {
        rebuildOwnerTable(db, tableName, columns);
      }
    }
    for (const sql of OWNER_INDEX_SQL) execSchemaSql(db, sql);
  };

  if (typeof db.transaction === "function") return db.transaction(migrate)();
  return migrate();
}


/**
 * 迁移 model_providers 表：添加 api_key_enc BLOB 字段（如果不存在）
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，需用 PRAGMA table_info 检查
 * @param {import('better-sqlite3').Database} db
 */
function migrateModelProvidersSchema(db) {
  const cols = db.prepare("PRAGMA table_info(model_providers)").all()
  const colNames = cols.map(c => c.name)
  if (!colNames.includes('api_key_enc')) {
    execSchemaSql(db, "ALTER TABLE model_providers ADD COLUMN api_key_enc BLOB")
  }
}

/**
 * 迁移 accounts 表：为 cookies/localStorage 添加加密 BLOB 列（如果不存在）
 * 对齐 model_providers.api_key_enc 的安全水位。
 * @param {import('better-sqlite3').Database} db
 */
function migrateAccountCredentialSchema(db) {
  const cols = db.prepare("PRAGMA table_info(accounts)").all()
  const colNames = cols.map(c => c.name)
  if (!colNames.includes('cookies_enc')) {
    execSchemaSql(db, "ALTER TABLE accounts ADD COLUMN cookies_enc BLOB")
  }
  if (!colNames.includes('localStorage_enc')) {
    execSchemaSql(db, "ALTER TABLE accounts ADD COLUMN localStorage_enc BLOB")
  }
  if (!colNames.includes('last_validated')) {
    execSchemaSql(db, "ALTER TABLE accounts ADD COLUMN last_validated TEXT")
  }
}


function migrateKnowledgeEvolutionSchema(db) {
  const tables = {
    viral_library: [
      "ALTER TABLE viral_library ADD COLUMN confidence     REAL    DEFAULT 0.5",
      "ALTER TABLE viral_library ADD COLUMN status         TEXT    DEFAULT 'active'",
      "ALTER TABLE viral_library ADD COLUMN access_count   INTEGER DEFAULT 0",
      "ALTER TABLE viral_library ADD COLUMN last_accessed  TEXT",
    ],
    personal_knowledge: [
      "ALTER TABLE personal_knowledge ADD COLUMN confidence     REAL    DEFAULT 0.5",
      "ALTER TABLE personal_knowledge ADD COLUMN status         TEXT    DEFAULT 'active'",
      "ALTER TABLE personal_knowledge ADD COLUMN access_count   INTEGER DEFAULT 0",
      "ALTER TABLE personal_knowledge ADD COLUMN last_accessed  TEXT",
      "ALTER TABLE personal_knowledge ADD COLUMN quality        REAL    DEFAULT 0.5",
    ],
  }

  for (const [table, cols] of Object.entries(tables)) {
    const existing = db.prepare("PRAGMA table_info(" + table + ")").all().map(function(c) { return c.name; })
    for (const sql of cols) {
      const colMatch = sql.match(/ADD COLUMN (\w+)/)
      const colName = colMatch ? colMatch[1] : null
      if (colName && !existing.includes(colName)) {
        if (typeof db.execOrThrow === "function") db.execOrThrow(sql)
        else db.exec(sql)
      }
    }
  }

  execSchemaSql(db, "CREATE INDEX IF NOT EXISTS idx_viral_status ON viral_library(status)")
  execSchemaSql(db, "CREATE INDEX IF NOT EXISTS idx_personal_status ON personal_knowledge(status)")

  const auditCols = db.prepare("PRAGMA table_info(knowledge_audit_log)").all()
  if (auditCols.length === 0) {
    execSchemaSql(db, "CREATE TABLE IF NOT EXISTS knowledge_audit_log ("
      + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
      + "target_table TEXT NOT NULL,"
      + "target_id TEXT NOT NULL,"
      + "event TEXT NOT NULL,"
      + "old_status TEXT,"
      + "new_status TEXT,"
      + "old_confidence REAL,"
      + "new_confidence REAL,"
      + "actor TEXT DEFAULT 'system',"
      + "created_at TEXT NOT NULL"
    + ")")
    execSchemaSql(db, "CREATE INDEX IF NOT EXISTS idx_audit_target ON knowledge_audit_log(target_table, target_id)")
    execSchemaSql(db, "CREATE INDEX IF NOT EXISTS idx_audit_event ON knowledge_audit_log(event, created_at)")
  }
}

/**
 * 模式卡片 schema（activate-viral-library PR-2）
 * viral_pattern_cards 与 viral_library 一对一；存量条目回填 pending 卡片。
 */
// activate-viral-library 迁移拆至独立文件（债务熔断：store-schema 不允许突破 500 行）
const { migrateViralPatternSchema: _migrateViralPattern, migratePerformanceLoopSchema: _migratePerformanceLoop } = require('./activate-viral-schema')
function migrateViralPatternSchema(db) { _migrateViralPattern(db, execSchemaSql) }
function migratePerformanceLoopSchema(db) { _migratePerformanceLoop(db, execSchemaSql) }

module.exports = {
  TABLE_NAMES,
  SCHEMA_SQL,
  LEGACY_OWNER_SUBJECT,
  OWNER_TABLE_SCHEMA_SQL,
  migrateOwnerIsolationSchema,
  migrateModelProvidersSchema,
  migrateAccountCredentialSchema,
  safeJsonParse,
  safeJsonStringify,
  buildUpdateQuery,
  sanitizeUpdateFields,
  UPDATE_WHITELIST,
  migrateKnowledgeEvolutionSchema,
  migrateViralPatternSchema,
  migratePerformanceLoopSchema,
};
