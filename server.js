const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const APP_PORT = Number(process.env.PORT || 3000);
const APP_DB_NAME = process.env.APP_DB_NAME || 'base3_app';
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PGHOST = String(process.env.PGHOST || '').trim();
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = String(process.env.PGUSER || '').trim() || 'postgres';
const PGPASSWORD = String(process.env.PGPASSWORD || '').trim();
const PGDATABASE = String(process.env.PGDATABASE || '').trim();
const PGSSLMODE = String(process.env.PGSSLMODE || '').trim().toLowerCase();
const PG_BIN_DIR = process.env.PG_BIN_DIR || 'C:\\Program Files\\PostgreSQL\\16\\bin';
const PG_DATA_DIR = process.env.PG_DATA_DIR || path.join(__dirname, 'pgdata');
const PG_LOG_DIR = path.join(__dirname, 'logs');
const PG_LOCAL_PORT = Number(process.env.PG_LOCAL_PORT || 5433);
const SESSION_COOKIE = 'base3_session';
const SESSION_DAYS = 7;
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const USE_LOCAL_POSTGRES = !DATABASE_URL && !PGHOST;
const COOKIE_SECURE = process.env.NODE_ENV === 'production';

const app = express();
let appPool = null;

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'style.css'));
});

app.get('/script.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'script.js'));
});

app.get('/api/health', async (req, res) => {
    try {
        const result = await getPool().query('SELECT 1 AS ok');
        res.json({ ok: Boolean(result.rows[0]?.ok) });
    } catch (error) {
        res.status(500).json({ error: 'db_unavailable' });
    }
});

app.post('/api/login', async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!username || !password) {
        return res.status(400).json({ error: 'missing_credentials' });
    }

    const db = getPool();
    const result = await db.query(
        'SELECT id, username, password_hash, role, created_at FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [username]
    );

    const user = result.rows[0];

    if (!user) {
        return res.status(401).json({ error: 'invalid_credentials' });
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
        return res.status(401).json({ error: 'invalid_credentials' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

    await db.query(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
        [token, user.id, expiresAt]
    );

    setSessionCookie(res, token, expiresAt);
    res.json({ user: mapUser(user) });
});

app.post('/api/logout', async (req, res) => {
    const token = req.cookies[SESSION_COOKIE];

    if (token) {
        try {
            await getPool().query('DELETE FROM sessions WHERE token = $1', [token]);
        } catch (error) {
            // ignore session cleanup errors
        }
    }

    clearSessionCookie(res);
    res.json({ ok: true });
});

app.get('/api/me', requireAuthOptional, (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    res.json({ user: req.user });
});

app.get('/api/bootstrap', requireAuth, async (req, res) => {
    const db = getPool();
    const [postsResult, configsResult] = await Promise.all([
        db.query('SELECT * FROM posts ORDER BY created_at DESC'),
        db.query('SELECT type, value FROM configs ORDER BY type, value')
    ]);

    const payload = {
        user: req.user,
        posts: postsResult.rows.map(mapPost),
        configs: {
            modules: configsResult.rows.filter(item => item.type === 'module').map(item => item.value),
            categories: configsResult.rows.filter(item => item.type === 'category').map(item => item.value)
        }
    };

    if (req.user.role === 'admin') {
        const usersResult = await db.query(
            'SELECT id, username, role, created_at FROM users ORDER BY username ASC'
        );
        payload.users = usersResult.rows.map(mapUser);
    }

    res.json(payload);
});

app.get('/api/configs', requireAuth, async (req, res) => {
    const result = await getPool().query('SELECT type, value FROM configs ORDER BY type, value');
    res.json({
        modules: result.rows.filter(item => item.type === 'module').map(item => item.value),
        categories: result.rows.filter(item => item.type === 'category').map(item => item.value)
    });
});

app.post('/api/configs', requireAuth, requireAdmin, async (req, res) => {
    const type = String(req.body?.type || '').trim();
    const value = String(req.body?.value || '').trim();

    if (!['module', 'category'].includes(type)) {
        return res.status(400).json({ error: 'invalid_type' });
    }

    if (!value) {
        return res.status(400).json({ error: 'missing_value' });
    }

    const db = getPool();
    const exists = await db.query(
        'SELECT 1 FROM configs WHERE type = $1 AND LOWER(value) = LOWER($2) LIMIT 1',
        [type, value]
    );

    if (!exists.rowCount) {
        await db.query('INSERT INTO configs (type, value) VALUES ($1, $2)', [type, value]);
    }

    res.json({ ok: true });
});

app.delete('/api/configs/:type/:value', requireAuth, requireAdmin, async (req, res) => {
    const type = String(req.params.type || '').trim();
    const value = String(req.params.value || '').trim();

    if (!['module', 'category'].includes(type)) {
        return res.status(400).json({ error: 'invalid_type' });
    }

    await getPool().query('DELETE FROM configs WHERE type = $1 AND value = $2', [type, value]);
    res.json({ ok: true });
});

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const result = await getPool().query(
        'SELECT id, username, role, created_at FROM users ORDER BY username ASC'
    );
    res.json({ users: result.rows.map(mapUser) });
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || '').trim().toLowerCase();

    if (!username || !password) {
        return res.status(400).json({ error: 'missing_fields' });
    }

    if (!['reader', 'editor'].includes(role)) {
        return res.status(400).json({ error: 'invalid_role' });
    }

    const db = getPool();
    const exists = await db.query(
        'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [username]
    );

    if (exists.rowCount) {
        return res.status(409).json({ error: 'user_exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
        [username, passwordHash, role]
    );

    res.status(201).json({ user: mapUser(result.rows[0]) });
});

app.delete('/api/users/:username', requireAuth, requireAdmin, async (req, res) => {
    const username = String(req.params.username || '').trim().toLowerCase();

    if (!username || username === ADMIN_USERNAME) {
        return res.status(400).json({ error: 'forbidden_user' });
    }

    await getPool().query('DELETE FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    res.json({ ok: true });
});

app.get('/api/posts', requireAuth, async (req, res) => {
    const result = await getPool().query('SELECT * FROM posts ORDER BY created_at DESC');
    res.json({ posts: result.rows.map(mapPost) });
});

app.post('/api/posts', requireAuth, requireEditor, async (req, res) => {
    const payload = buildPostPayload(req.body);

    if (!payload.valid) {
        return res.status(400).json({ error: payload.error });
    }

    const db = getPool();
    await db.query(
        `INSERT INTO posts (
            id, title, module, category, problem, solution, author,
            created_at, updated_at, problem_images, solution_images
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8, $9)`,
        [
            payload.id,
            payload.title,
            payload.module,
            payload.category,
            payload.problem,
            payload.solution,
            req.user.username,
            JSON.stringify(payload.problemImages),
            JSON.stringify(payload.solutionImages)
        ]
    );

    const result = await db.query('SELECT * FROM posts WHERE id = $1', [payload.id]);
    res.status(201).json({ post: mapPost(result.rows[0]) });
});

app.put('/api/posts/:id', requireAuth, requireEditor, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const payload = buildPostPayload(req.body, id);

    if (!payload.valid) {
        return res.status(400).json({ error: payload.error });
    }

    const db = getPool();
    const existing = await db.query('SELECT * FROM posts WHERE id = $1', [id]);

    if (!existing.rowCount) {
        return res.status(404).json({ error: 'post_not_found' });
    }

    const current = existing.rows[0];
    await db.query(
        `UPDATE posts SET
            title = $2,
            module = $3,
            category = $4,
            problem = $5,
            solution = $6,
            updated_at = NOW(),
            problem_images = $7,
            solution_images = $8
        WHERE id = $1`,
        [
            id,
            payload.title,
            payload.module,
            payload.category,
            payload.problem,
            payload.solution,
            payload.problemImages.length > 0 ? JSON.stringify(payload.problemImages) : current.problem_images,
            payload.solutionImages.length > 0 ? JSON.stringify(payload.solutionImages) : current.solution_images
        ]
    );

    const result = await db.query('SELECT * FROM posts WHERE id = $1', [id]);
    res.json({ post: mapPost(result.rows[0]) });
});

app.delete('/api/posts/:id', requireAuth, requireEditor, async (req, res) => {
    const id = String(req.params.id || '').trim();
    await getPool().query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ ok: true });
});

async function main() {
    if (USE_LOCAL_POSTGRES) {
        console.log('Starting local PostgreSQL...');
        await ensureLocalPostgres();
        console.log('Local PostgreSQL ready.');
    } else {
        console.log('Using managed PostgreSQL from environment variables.');
    }

    await initializeDatabase();
    console.log('Database ready.');

    app.listen(APP_PORT, () => {
        console.log(`Base3 listening on http://localhost:${APP_PORT}`);
    });
}

main().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
});

function getPool() {
    if (!appPool) {
        throw new Error('database_not_ready');
    }

    return appPool;
}

function createDbConfig(databaseOverride) {
    const ssl = shouldUseSsl();

    if (DATABASE_URL) {
        return {
            connectionString: DATABASE_URL,
            ssl
        };
    }

    if (PGHOST) {
        return {
            host: PGHOST,
            port: PGPORT,
            user: PGUSER,
            password: PGPASSWORD || undefined,
            database: databaseOverride || PGDATABASE || 'postgres',
            ssl
        };
    }

    return {
        host: '127.0.0.1',
        port: PG_LOCAL_PORT,
        user: 'postgres',
        database: databaseOverride || APP_DB_NAME,
        ssl: false
    };
}

function shouldUseSsl() {
    if (PGSSLMODE === 'disable') {
        return false;
    }

    if (PGSSLMODE === 'require' || DATABASE_URL) {
        return { rejectUnauthorized: false };
    }

    return false;
}

async function ensureLocalPostgres() {
    await fsp.mkdir(PG_DATA_DIR, { recursive: true });
    await fsp.mkdir(PG_LOG_DIR, { recursive: true });

    const versionFile = path.join(PG_DATA_DIR, 'PG_VERSION');
    if (!fs.existsSync(versionFile)) {
        await runBinary('initdb.exe', [
            '-D', PG_DATA_DIR,
            '-U', 'postgres',
            '--auth-local=trust',
            '--auth-host=trust',
            '--encoding=UTF8'
        ]);
    }

    const ready = await isPostgresReady();
    if (!ready) {
        const logFile = path.join(PG_LOG_DIR, 'postgres.log');
        await runBinary('pg_ctl.exe', [
            'start',
            '-D', PG_DATA_DIR,
            '-o', `-p ${PG_LOCAL_PORT} -h 127.0.0.1`,
            '-l', logFile,
            '-w'
        ]);
    }

    const timeoutAt = Date.now() + 15000;
    while (Date.now() < timeoutAt) {
        if (await isPostgresReady()) {
            return;
        }
        await sleep(500);
    }

    throw new Error('postgres_not_ready');
}

async function isPostgresReady() {
    try {
        await runBinary('pg_isready.exe', [
            '-h', '127.0.0.1',
            '-p', String(PG_LOCAL_PORT),
            '-d', 'postgres'
        ]);
        return true;
    } catch {
        return false;
    }
}

async function initializeDatabase() {
    if (USE_LOCAL_POSTGRES) {
        const maintenancePool = new Pool(createDbConfig('postgres'));
        try {
            const exists = await maintenancePool.query(
                'SELECT 1 FROM pg_database WHERE datname = $1',
                [APP_DB_NAME]
            );

            if (!exists.rowCount) {
                await maintenancePool.query(`CREATE DATABASE ${quoteIdentifier(APP_DB_NAME)}`);
            }
        } finally {
            await maintenancePool.end();
        }

        appPool = new Pool(createDbConfig(APP_DB_NAME));
    } else {
        appPool = new Pool(createDbConfig());
    }

    await createSchema();
    await seedInitialData();
}

async function createSchema() {
    const statements = [
        `CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reader')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS configs (
            id SERIAL PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('module', 'category')),
            value TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (type, value)
        )`,
        `CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            module TEXT NOT NULL,
            category TEXT NOT NULL,
            problem TEXT NOT NULL,
            solution TEXT NOT NULL,
            author TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            problem_images JSONB NOT NULL DEFAULT '[]'::jsonb,
            solution_images JSONB NOT NULL DEFAULT '[]'::jsonb
        )`,
        `CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
    ];

    for (const statement of statements) {
        await appPool.query(statement);
    }
}

async function seedInitialData() {
    const userCount = await appPool.query('SELECT COUNT(*)::int AS total FROM users');
    if (userCount.rows[0].total === 0) {
        const initialPassword = ADMIN_PASSWORD || (USE_LOCAL_POSTGRES ? 'admin' : '');
        if (!initialPassword) {
            throw new Error('ADMIN_PASSWORD is required for first production deploy.');
        }

        const passwordHash = await bcrypt.hash(initialPassword, 10);
        await appPool.query(
            'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
            [ADMIN_USERNAME, passwordHash, 'admin']
        );
    }

    const configCount = await appPool.query('SELECT COUNT(*)::int AS total FROM configs');
    if (configCount.rows[0].total === 0) {
        await appPool.query(
            `INSERT INTO configs (type, value)
             VALUES ('module', 'Geral'), ('category', 'Erro')`
        );
    }
}

async function requireAuthOptional(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const result = await getPool().query(
            `SELECT u.id, u.username, u.role, u.created_at, s.expires_at
             FROM sessions s
             INNER JOIN users u ON u.id = s.user_id
             WHERE s.token = $1 AND s.expires_at > NOW()
             LIMIT 1`,
            [token]
        );

        if (!result.rowCount) {
            req.user = null;
            return next();
        }

        const user = result.rows[0];
        req.user = mapUser(user);
        req.sessionExpiresAt = user.expires_at;
        return next();
    } catch (error) {
        req.user = null;
        return next();
    }
}

async function requireAuth(req, res, next) {
    await requireAuthOptional(req, res, () => {});

    if (!req.user) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    return next();
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'forbidden' });
    }

    return next();
}

function requireEditor(req, res, next) {
    if (!req.user || !['admin', 'editor'].includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    return next();
}

function buildPostPayload(body, existingId = null) {
    const title = String(body?.title || '').trim();
    const moduleName = String(body?.module || '').trim();
    const category = String(body?.category || '').trim();
    const problem = String(body?.problem || '').trim();
    const solution = String(body?.solution || '').trim();
    const problemImages = normalizeImages(body?.problemImages);
    const solutionImages = normalizeImages(body?.solutionImages);

    if (!title || !moduleName || !category || !problem || !solution) {
        return { valid: false, error: 'missing_fields' };
    }

    return {
        valid: true,
        id: existingId || String(body?.id || '').trim() || `post_${Date.now()}`,
        title,
        module: moduleName,
        category,
        problem,
        solution,
        problemImages,
        solutionImages
    };
}

function mapUser(row) {
    return {
        id: row.id,
        username: row.username,
        role: row.role,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    };
}

function mapPost(row) {
    return {
        id: row.id,
        title: row.title,
        module: row.module,
        category: row.category,
        problem: row.problem,
        solution: row.solution,
        author: row.author,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        problemImages: normalizeImages(row.problem_images),
        solutionImages: normalizeImages(row.solution_images)
    };
}

function normalizeImages(images) {
    let list = images;

    if (typeof list === 'string') {
        try {
            list = JSON.parse(list);
        } catch {
            list = [];
        }
    }

    if (!Array.isArray(list)) {
        return [];
    }

    return list
        .map(image => ({
            name: String(image?.name || 'Imagem anexada'),
            type: String(image?.type || ''),
            size: Number(image?.size || 0),
            data: String(image?.data || '')
        }))
        .filter(image => image.data.startsWith('data:image/'));
}

function setSessionCookie(res, token, expiresAt) {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
        expires: expiresAt
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE
    });
}

function quoteIdentifier(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

async function runBinary(fileName, args) {
    const command = path.join(PG_BIN_DIR, fileName);
    return execFileAsync(command, args, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
