require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// ==================== ROTAS ====================

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
      login: 'POST /api/auth/login'
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🗄️  Status do banco: ${dbConnected ? 'CONECTADO' : 'DESCONECTADO'}`);
});
