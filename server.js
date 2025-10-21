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

// Configuração do banco de dados
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ==================== INICIALIZAÇÃO DO BANCO ====================

async function initializeDatabase() {
  try {
    // Tabela de usuários
    await db.query(`
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

    // Tabela de tokens de recuperação
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        token VARCHAR(500) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Banco de dados inicializado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco:', error);
  }
}
// === ADICIONE ESTAS LINHAS ===

// Rota raiz - Resolve "Cannot GET /"
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
      // Adicione outras rotas que você tiver
    },
    documentation: 'https://github.com/Xirtam33/bbh-backend',
    status: '🟢 Online'
  });
});

// === FIM DA ADIÇÃO ===
// ==================== ROTAS DA API ====================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '🚀 BBH Backend API Online!',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    domain: 'bricsbusinesshub.com.br'
  });
});

// Registrar nova empresa
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, companyName, country, businessSegment } = req.body;

    // Validação
    if (!name || !email || !password || !companyName) {
      return res.status(400).json({
        success: false,
        message: 'Nome, e-mail, senha e nome da empresa são obrigatórios'
      });
    }

    // Verificar se e-mail já existe
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Este e-mail já está cadastrado'
      });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 12);

    // Inserir usuário
    const result = await db.query(
      `INSERT INTO users (name, email, password, company_name, country, business_segment) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, name, email, company_name, country, business_segment`,
      [name, email, hashedPassword, companyName, country, businessSegment]
    );

    const user = result.rows[0];

    // Gerar token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'bbh-default-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Empresa cadastrada com sucesso! 🎉',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        companyName: user.company_name,
        country: user.country,
        businessSegment: user.business_segment
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

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Buscar usuário
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'E-mail ou senha incorretos'
      });
    }

    const user = result.rows[0];

    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'E-mail ou senha incorretos'
      });
    }

    // Gerar token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'bbh-default-secret',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login realizado com sucesso! 🎉',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        companyName: user.company_name,
        country: user.country,
        businessSegment: user.business_segment
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

// Recuperação de Senha - FUNCIONALIDADE REAL
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Buscar usuário
    const userResult = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'E-mail não encontrado em nosso sistema'
      });
    }

    const user = userResult.rows[0];

    // Gerar token único
    const token = jwt.sign(
      { userId: user.id, type: 'password_reset' },
      process.env.JWT_SECRET || 'bbh-default-secret',
      { expiresIn: '1h' }
    );

    // Salvar token no banco
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) 
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, token]
    );

    // Se SendGrid estiver configurado, enviar e-mail real
    if (process.env.SENDGRID_API_KEY) {
      const resetLink = `https://bricsbusinesshub.com.br/redefinir-senha?token=${token}`;
      
      const msg = {
        to: email,
        from: {
          email: 'noreply@bricsbusinesshub.com.br',
          name: 'BBH Business Hub'
        },
        subject: 'Recuperação de Senha - BBH Business Hub',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4361ee;">BBH Business Hub</h2>
            <p><strong>Recuperação de Senha</strong></p>
            <p>Olá ${user.name},</p>
            <p>Clique no link abaixo para redefinir sua senha:</p>
            <a href="${resetLink}" style="background-color: #4361ee; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Redefinir Senha
            </a>
            <p>Este link expira em 1 hora.</p>
            <br>
            <p>Atenciosamente,<br>Equipe BBH Business Hub</p>
          </div>
        `
      };

      await sgMail.send(msg);
      console.log(`📧 E-mail de recuperação enviado para: ${email}`);
    }

    res.json({
      success: true,
      message: 'E-mail de recuperação enviado com sucesso!'
    });

  } catch (error) {
    console.error('Erro no forgot-password:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao processar solicitação'
    });
  }
});

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token de acesso necessário'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bbh-default-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Token inválido ou expirado'
    });
  }
};

// Dashboard - Estatísticas
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    // Estatísticas mockadas (pode conectar com dados reais depois)
    const stats = {
      totalProjects: 142,
      completionRate: 87,
      newUsers: 324,
      averageTime: 3.2,
      activeCompanies: 56,
      pendingMatches: 23
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Erro ao buscar stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Listar empresas (matchmaking)
app.get('/api/companies', authenticateToken, async (req, res) => {
  try {
    const companies = await db.query(`
      SELECT id, name, company_name, country, business_segment, created_at 
      FROM users 
      WHERE id != $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [req.user.userId]);

    res.json({
      success: true,
      data: companies.rows
    });

  } catch (error) {
    console.error('Erro ao buscar empresas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ==================== INICIALIZAÇÃO DO SERVIDOR ====================

app.listen(PORT, async () => {
  await initializeDatabase();
  console.log(`🚀 Servidor BBH Backend rodando na porta ${PORT}`);
  console.log(`🌐 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`🔗 Domínio: bricsbusinesshub.com.br`);
});

module.exports = app;
