require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

console.log('🔧 Iniciando servidor...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Configurada' : '❌ Não configurada');

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

    console.log('📝 DATABASE_URL:', process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@')); // Esconde senha
    
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { 
        rejectUnauthorized: false,
        require: true
      },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000
    });

    // Testar conexão
    console.log('🔄 Conectando...');
    const client = await db.connect();
    console.log('✅ Conectado ao PostgreSQL com sucesso!');
    
    // Criar tabelas
    console.log('🔄 Criando tabelas...');
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
    console.error('📋 Detalhes do erro:', error);
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🗄️ Status do banco: ${dbConnected ? '✅ CONECTADO' : '❌ DESCONECTADO'}`);
});
