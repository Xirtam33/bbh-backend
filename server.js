require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuração do SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Configuração do banco de dados com reconexão automática
let db;
let isDatabaseConnected = false;

async function initializeDatabase() {
  try {
    if (!process.env.DATABASE_URL) {
      console.log('⏳ Aguardando configuração do DATABASE_URL...');
      return;
    }

    console.log('🔗 Conectando ao PostgreSQL...');
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        token VARCHAR(500) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    client.release();
    isDatabaseConnected = true;
    console.log('✅ Tabelas verificadas/criadas com sucesso!');

  } catch (error) {
    console.error('❌ Erro na inicialização do banco:', error.message);
    isDatabaseConnected = false;
    
    // Tentar reconectar após 10 segundos
    setTimeout(initializeDatabase, 10000);
  }
}

// ==================== ROTA RAIZ ====================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 BBH Backend API - BRICS Business Hub',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users'
    },
    documentation: 'https://github.com/Xirtam33/bbh-backend',
    status: '🟢 Online'
  });
});

// ==================== AUTENTICAÇÃO JWT ====================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token de acesso requerido'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
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

// Rota base de auth - INFO
app.get('/api/auth', (req, res) => {
  res.json({
    success: true,
    message: '🔐 Sistema de Autenticação BBH',
    endpoints: {
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      forgot_password: 'POST /api/auth/forgot-password',
      reset_password: 'POST /api/auth/reset-password',
      profile: 'GET /api/auth/profile (protected)'
    },
    database: isDatabaseConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// REGISTRO DE USUÁRIO
app.post('/api/auth/register', async (req, res) => {
  if (!isDatabaseConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { name, email, password, company_name, country, business_segment } = req.body;

    if (!name || !email || !password || !company_name) {
      return res.status(400).json({
        success: false,
        message: 'Todos os campos obrigatórios devem ser preenchidos'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Senha deve ter pelo menos 6 caracteres'
      });
    }

    const userExists = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Usuário já cadastrado com este email'
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await db.query(
      `INSERT INTO users (name, email, password, company_name, country, business_segment) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, name, email, company_name, country, business_segment, created_at`,
      [name, email, hashedPassword, company_name, country, business_segment]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'Usuário registrado com sucesso!',
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
  if (!isDatabaseConnected) {
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

    const result = await db.query(
      `SELECT id, name, email, password, company_name, country, business_segment, created_at 
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login realizado com sucesso!',
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

// PERFIL DO USUÁRIO (PROTEGIDO)
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  if (!isDatabaseConnected) {
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

// ==================== HEALTH CHECK ====================
app.get('/api/health', async (req, res) => {
  const health = {
    success: true,
    message: '🚀 BBH Backend API Online!',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    domain: 'bricsbusinesshub.com.br',
    database: isDatabaseConnected ? 'connected' : 'disconnected'
  };

  res.status(isDatabaseConnected ? 200 : 503).json(health);
});

// ==================== INICIALIZAÇÃO ====================
async function startServer() {
  await initializeDatabase();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor BBH Backend rodando na porta ${PORT}`);
    console.log(`🌐 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Domínio: bricsbusinesshub.com.br`);
    console.log(`🗄️  Database: ${isDatabaseConnected ? '✅ Conectado' : '❌ Desconectado'}`);
  });
}

startServer();
