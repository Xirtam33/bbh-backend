require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuração do banco
let db;
let dbConnected = false;

async function initializeDatabase() {
  try {
    console.log('🔗 Tentando conectar ao PostgreSQL...');
    
    if (!process.env.DATABASE_URL) {
      console.log('❌ DATABASE_URL não encontrada');
      return;
    }

    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    // Testar conexão
    const client = await db.connect();
    console.log('✅ Conectado ao PostgreSQL com sucesso!');
    
    // Criar tabelas
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        country VARCHAR(100),
        business_segment VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Tabela de usuários verificada/criada!');
    client.release();
    dbConnected = true;
    
  } catch (error) {
    console.error('❌ Erro na conexão com o banco:', error.message);
    dbConnected = false;
  }
}

// Inicializar banco
initializeDatabase();

// ==================== MIDDLEWARE DE AUTENTICAÇÃO ====================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token de acesso requerido'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Token inválido ou expirado'
      });
    }
    req.user = user;
    next();
  });
};

// ==================== ROTAS PÚBLICAS ====================

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 BBH Backend API - BRICS Business Hub',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// Health Check
app.get('/api/health', async (req, res) => {
  res.json({
    success: true,
    message: '🚀 BBH Backend API Online!',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    version: '1.0.0'
  });
});

// Auth Info
app.get('/api/auth', (req, res) => {
  res.json({
    success: true,
    message: '🔐 Sistema de Autenticação BBH',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    endpoints: {
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      profile: 'GET /api/auth/profile (protected)'
    }
  });
});

// Rota de teste do banco
app.get('/api/test-db', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Banco de dados não conectado'
    });
  }

  try {
    const result = await db.query('SELECT NOW() as current_time');
    res.json({
      success: true,
      message: '✅ Banco de dados funcionando!',
      current_time: result.rows[0].current_time
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '❌ Erro no banco de dados',
      error: error.message
    });
  }
});

// ==================== AUTENTICAÇÃO ====================

// REGISTRO DE USUÁRIO
app.post('/api/auth/register', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { name, email, password, company_name, country, business_segment } = req.body;

    // Validações
    if (!name || !email || !password || !company_name) {
      return res.status(400).json({
        success: false,
        message: 'Nome, email, senha e nome da empresa são obrigatórios'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Senha deve ter pelo menos 6 caracteres'
      });
    }

    // Verificar se usuário já existe
    const userExists = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userExists.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Usuário já cadastrado com este email'
      });
    }

    // Criptografar senha
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Inserir usuário
    const result = await db.query(
      `INSERT INTO users (name, email, password, company_name, country, business_segment) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, name, email, company_name, country, business_segment, created_at`,
      [name, email.toLowerCase(), hashedPassword, company_name, country, business_segment]
    );

    const user = result.rows[0];

    // Gerar token JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'Usuário registrado com sucesso! 🎉',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_name: user.company_name,
        country: user.country,
        business_segment: user.business_segment,
        created_at: user.created_at
      },
      token: token
    });

  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// LOGIN DE USUÁRIO
app.post('/api/auth/login', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email e senha são obrigatórios'
      });
    }

    // Buscar usuário
    const result = await db.query(
      `SELECT id, name, email, password, company_name, country, business_segment, created_at 
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    const user = result.rows[0];

    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    // Gerar token JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login realizado com sucesso! 👋',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_name: user.company_name,
        country: user.country,
        business_segment: user.business_segment,
        created_at: user.created_at
      },
      token: token
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ==================== ROTAS PROTEGIDAS ====================

// PERFIL DO USUÁRIO (PROTEGIDO)
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const result = await db.query(
      `SELECT id, name, email, company_name, country, business_segment, created_at 
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: user
    });

  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// LISTAR USUÁRIOS (PROTEGIDO - para admin)
app.get('/api/users', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const result = await db.query(
      `SELECT id, name, email, company_name, country, business_segment, created_at 
       FROM users ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      users: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🗄️ Status do banco: ${dbConnected ? 'CONECTADO' : 'DESCONECTADO'}`);
  console.log(`🔐 Sistema de autenticação: ✅ PRONTO`);
});
