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

// Lista expandida de países BRICS+
const BRICS_PLUS_COUNTRIES = [
  'Brazil', 'Russia', 'India', 'China', 'South Africa',
  'Argentina', 'Egypt', 'Ethiopia', 'Iran', 'Saudi Arabia',
  'United Arab Emirates', 'Mexico', 'Nigeria', 'Turkey',
  'Indonesia', 'Bangladesh', 'Vietnam', 'Thailand', 'Malaysia'
];

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        company_name VARCHAR(255) NOT NULL,
        description TEXT,
        country VARCHAR(100) NOT NULL,
        business_type VARCHAR(100) NOT NULL,
        products_services TEXT,
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        website VARCHAR(255),
        address TEXT,
        annual_revenue VARCHAR(100),
        employee_count VARCHAR(50),
        brics_countries TEXT[], -- Array para países BRICS+ de interesse
        tags TEXT[], -- Tags para busca
        is_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Índices para busca rápida
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_businesses_country ON businesses(country);
      CREATE INDEX IF NOT EXISTS idx_businesses_business_type ON businesses(business_type);
      CREATE INDEX IF NOT EXISTS idx_businesses_tags ON businesses USING gin(tags);
      CREATE INDEX IF NOT EXISTS idx_businesses_brics_countries ON businesses USING gin(brics_countries);
    `);
    
    console.log('✅ Tabelas verificadas/criadas com sucesso!');
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
    database: dbConnected ? 'connected' : 'disconnected',
    countries: BRICS_PLUS_COUNTRIES
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

// Info dos países BRICS+
app.get('/api/countries', (req, res) => {
  res.json({
    success: true,
    countries: BRICS_PLUS_COUNTRIES,
    count: BRICS_PLUS_COUNTRIES.length,
    timestamp: new Date().toISOString()
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

// ==================== EMPRESAS BRICS+ ====================

// LISTAR TODAS AS EMPRESAS (com filtros)
app.get('/api/businesses', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { 
      country, 
      business_type, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

    let query = `
      SELECT b.*, u.name as user_name, u.email as user_email 
      FROM businesses b 
      LEFT JOIN users u ON b.user_id = u.id 
      WHERE b.is_active = true
    `;
    const params = [];
    let paramCount = 0;

    // Filtros
    if (country) {
      paramCount++;
      query += ` AND b.country = $${paramCount}`;
      params.push(country);
    }

    if (business_type) {
      paramCount++;
      query += ` AND b.business_type = $${paramCount}`;
      params.push(business_type);
    }

    if (search) {
      paramCount++;
      query += ` AND (
        b.company_name ILIKE $${paramCount} OR 
        b.description ILIKE $${paramCount} OR 
        b.products_services ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    // Ordenação e paginação
    query += ` ORDER BY b.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await db.query(query, params);

    // Contagem total
    let countQuery = query.replace(/SELECT b\.\*, u\.name as user_name, u\.email as user_email/, 'SELECT COUNT(*)')
                         .replace(/ORDER BY b\.created_at DESC LIMIT \$\d+ OFFSET \$\d+/, '');
    const countResult = await db.query(countQuery, params.slice(0, -2));

    res.json({
      success: true,
      businesses: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// BUSCAR EMPRESA POR ID
app.get('/api/businesses/:id', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT b.*, u.name as user_name, u.email as user_email 
       FROM businesses b 
       LEFT JOIN users u ON b.user_id = u.id 
       WHERE b.id = $1 AND b.is_active = true`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Empresa não encontrada'
      });
    }

    res.json({
      success: true,
      business: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao buscar empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// CRIAR EMPRESA (PROTEGIDO)
app.post('/api/businesses', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const {
      company_name,
      description,
      country,
      business_type,
      products_services,
      contact_email,
      contact_phone,
      website,
      address,
      annual_revenue,
      employee_count,
      brics_countries,
      tags
    } = req.body;

    // Validações
    if (!company_name || !country || !business_type) {
      return res.status(400).json({
        success: false,
        message: 'Nome da empresa, país e tipo de negócio são obrigatórios'
      });
    }

    // Validar países BRICS+
    if (brics_countries) {
      const invalidCountries = brics_countries.filter(country => !BRICS_PLUS_COUNTRIES.includes(country));
      if (invalidCountries.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Países BRICS+ inválidos: ${invalidCountries.join(', ')}. Países válidos: ${BRICS_PLUS_COUNTRIES.join(', ')}`
        });
      }
    }

    const result = await db.query(
      `INSERT INTO businesses (
        user_id, company_name, description, country, business_type, 
        products_services, contact_email, contact_phone, website, 
        address, annual_revenue, employee_count, brics_countries, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        req.user.userId,
        company_name,
        description,
        country,
        business_type,
        products_services,
        contact_email,
        contact_phone,
        website,
        address,
        annual_revenue,
        employee_count,
        brics_countries,
        tags
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Empresa cadastrada com sucesso! 🎉',
      business: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ATUALIZAR EMPRESA (PROTEGIDO - apenas dono)
app.put('/api/businesses/:id', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { id } = req.params;
    const updateFields = req.body;

    // Verificar se a empresa existe e pertence ao usuário
    const existingBusiness = await db.query(
      'SELECT user_id FROM businesses WHERE id = $1',
      [id]
    );

    if (existingBusiness.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Empresa não encontrada'
      });
    }

    if (existingBusiness.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado - esta empresa pertence a outro usuário'
      });
    }

    // Validar países BRICS+ se for atualizado
    if (updateFields.brics_countries) {
      const invalidCountries = updateFields.brics_countries.filter(country => !BRICS_PLUS_COUNTRIES.includes(country));
      if (invalidCountries.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Países BRICS+ inválidos: ${invalidCountries.join(', ')}`
        });
      }
    }

    // Construir query dinâmica
    const setClause = Object.keys(updateFields)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    
    const values = Object.values(updateFields);
    values.unshift(id);

    const result = await db.query(
      `UPDATE businesses 
       SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      values
    );

    res.json({
      success: true,
      message: 'Empresa atualizada com sucesso! ✅',
      business: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETAR EMPRESA (PROTEGIDO - apenas dono)
app.delete('/api/businesses/:id', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { id } = req.params;

    // Verificar se a empresa existe e pertence ao usuário
    const existingBusiness = await db.query(
      'SELECT user_id FROM businesses WHERE id = $1',
      [id]
    );

    if (existingBusiness.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Empresa não encontrada'
      });
    }

    if (existingBusiness.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado - esta empresa pertence a outro usuário'
      });
    }

    await db.query('DELETE FROM businesses WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Empresa deletada com sucesso! 🗑️'
    });

  } catch (error) {
    console.error('Erro ao deletar empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// MINHAS EMPRESAS (PROTEGIDO)
app.get('/api/my-businesses', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const result = await db.query(
      'SELECT * FROM businesses WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );

    res.json({
      success: true,
      businesses: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Erro ao buscar minhas empresas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ESTATÍSTICAS DE EMPRESAS (PROTEGIDO)
app.get('/api/businesses-stats', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const totalBusinesses = await db.query('SELECT COUNT(*) FROM businesses WHERE is_active = true');
    const businessesByCountry = await db.query('SELECT country, COUNT(*) FROM businesses WHERE is_active = true GROUP BY country ORDER BY COUNT(*) DESC');
    const recentBusinesses = await db.query('SELECT COUNT(*) FROM businesses WHERE created_at >= NOW() - INTERVAL \'7 days\'');

    res.json({
      success: true,
      stats: {
        total: parseInt(totalBusinesses.rows[0].count),
        by_country: businessesByCountry.rows,
        recent_week: parseInt(recentBusinesses.rows[0].count),
        countries_supported: BRICS_PLUS_COUNTRIES.length
      }
    });

  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🗄️ Status do banco: ${dbConnected ? 'CONECTADO' : 'DESCONECTADO'}`);
  console.log(`🌍 Países BRICS+: ${BRICS_PLUS_COUNTRIES.length} países`);
  console.log(`🔐 Sistema de autenticação: ✅ PRONTO`);
  console.log(`🏢 Sistema de empresas: ✅ PRONTO`);
});
