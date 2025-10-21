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

// Categorias de oportunidades
const OPPORTUNITY_CATEGORIES = [
  'Agriculture', 'Technology', 'Manufacturing', 'Energy', 'Mining',
  'Infrastructure', 'Healthcare', 'Education', 'Tourism', 'Finance',
  'Real Estate', 'Transportation', 'Retail', 'Construction', 'Automotive',
  'Pharmaceuticals', 'Textiles', 'Food & Beverage', 'Telecommunications', 'Other'
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
        brics_countries TEXT[],
        tags TEXT[],
        is_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        type VARCHAR(50) NOT NULL, -- 'offer' or 'demand'
        category VARCHAR(100) NOT NULL,
        country VARCHAR(100) NOT NULL,
        budget VARCHAR(100),
        deadline DATE,
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        tags TEXT[],
        status VARCHAR(50) DEFAULT 'active',
        view_count INTEGER DEFAULT 0,
        is_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        opportunity_id INTEGER REFERENCES opportunities(id),
        business_id INTEGER REFERENCES businesses(id),
        match_score INTEGER,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Índices para busca rápida
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_businesses_country ON businesses(country);
      CREATE INDEX IF NOT EXISTS idx_businesses_business_type ON businesses(business_type);
      CREATE INDEX IF NOT EXISTS idx_businesses_tags ON businesses USING gin(tags);
      CREATE INDEX IF NOT EXISTS idx_opportunities_country ON opportunities(country);
      CREATE INDEX IF NOT EXISTS idx_opportunities_category ON opportunities(category);
      CREATE INDEX IF NOT EXISTS idx_opportunities_type ON opportunities(type);
      CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_opportunities_tags ON opportunities USING gin(tags);
    `);
    
    console.log('✅ Todas as tabelas verificadas/criadas com sucesso!');
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
  const token = authHeader && authHeader.split(' ')[1];

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
    countries: BRICS_PLUS_COUNTRIES,
    categories: OPPORTUNITY_CATEGORIES
  });
});

// Health Check
app.get('/api/health', async (req, res) => {
  res.json({
    success: true,
    message: '🚀 BBH Backend API Online!',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    version: '2.0.0'
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

// Info das categorias
app.get('/api/categories', (req, res) => {
  res.json({
    success: true,
    categories: OPPORTUNITY_CATEGORIES,
    count: OPPORTUNITY_CATEGORIES.length,
    timestamp: new Date().toISOString()
  });
});

// ==================== AUTENTICAÇÃO ====================

// ... (manter todas as rotas de auth existentes - register, login, profile, users)

// ==================== EMPRESAS BRICS+ ====================

// ... (manter todas as rotas de businesses existentes)

// ==================== SISTEMA DE OPORTUNIDADES ====================

// LISTAR OPORTUNIDADES (com filtros)
app.get('/api/opportunities', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { 
      type, 
      category, 
      country, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

    let query = `
      SELECT o.*, u.name as user_name, u.company_name as user_company 
      FROM opportunities o 
      LEFT JOIN users u ON o.user_id = u.id 
      WHERE o.status = 'active'
    `;
    const params = [];
    let paramCount = 0;

    // Filtros
    if (type) {
      paramCount++;
      query += ` AND o.type = $${paramCount}`;
      params.push(type);
    }

    if (category) {
      paramCount++;
      query += ` AND o.category = $${paramCount}`;
      params.push(category);
    }

    if (country) {
      paramCount++;
      query += ` AND o.country = $${paramCount}`;
      params.push(country);
    }

    if (search) {
      paramCount++;
      query += ` AND (
        o.title ILIKE $${paramCount} OR 
        o.description ILIKE $${paramCount} OR
        o.tags::text ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    // Ordenação e paginação
    query += ` ORDER BY o.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await db.query(query, params);

    // Contagem total
    let countQuery = query.replace(/SELECT o\.\*, u\.name as user_name, u\.company_name as user_company/, 'SELECT COUNT(*)')
                         .replace(/ORDER BY o\.created_at DESC LIMIT \$\d+ OFFSET \$\d+/, '');
    const countResult = await db.query(countQuery, params.slice(0, -2));

    res.json({
      success: true,
      opportunities: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Erro ao listar oportunidades:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// BUSCAR OPORTUNIDADE POR ID
app.get('/api/opportunities/:id', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { id } = req.params;

    // Incrementar contador de visualizações
    await db.query(
      'UPDATE opportunities SET view_count = view_count + 1 WHERE id = $1',
      [id]
    );

    const result = await db.query(
      `SELECT o.*, u.name as user_name, u.company_name as user_company, u.email as user_email 
       FROM opportunities o 
       LEFT JOIN users u ON o.user_id = u.id 
       WHERE o.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Oportunidade não encontrada'
      });
    }

    res.json({
      success: true,
      opportunity: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao buscar oportunidade:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// CRIAR OPORTUNIDADE (PROTEGIDO)
app.post('/api/opportunities', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const {
      title,
      description,
      type,
      category,
      country,
      budget,
      deadline,
      contact_email,
      contact_phone,
      tags
    } = req.body;

    // Validações
    if (!title || !description || !type || !category || !country) {
      return res.status(400).json({
        success: false,
        message: 'Título, descrição, tipo, categoria e país são obrigatórios'
      });
    }

    if (!['offer', 'demand'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Tipo deve ser "offer" ou "demand"'
      });
    }

    if (!OPPORTUNITY_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Categoria inválida. Categorias válidas: ${OPPORTUNITY_CATEGORIES.join(', ')}`
      });
    }

    const result = await db.query(
      `INSERT INTO opportunities (
        user_id, title, description, type, category, country, 
        budget, deadline, contact_email, contact_phone, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        req.user.userId,
        title,
        description,
        type,
        category,
        country,
        budget,
        deadline,
        contact_email,
        contact_phone,
        tags
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Oportunidade criada com sucesso! 🎉',
      opportunity: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar oportunidade:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// MINHAS OPORTUNIDADES (PROTEGIDO)
app.get('/api/my-opportunities', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const result = await db.query(
      'SELECT * FROM opportunities WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );

    res.json({
      success: true,
      opportunities: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Erro ao buscar minhas oportunidades:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ==================== SISTEMA DE MATCHES ====================

// GERAR MATCHES PARA UMA OPORTUNIDADE
app.get('/api/opportunities/:id/matches', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    const { id } = req.params;

    // Buscar a oportunidade
    const opportunityResult = await db.query(
      'SELECT * FROM opportunities WHERE id = $1',
      [id]
    );

    if (opportunityResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Oportunidade não encontrada'
      });
    }

    const opportunity = opportunityResult.rows[0];

    // Buscar matches potenciais (empresas com interesses compatíveis)
    let matchQuery = `
      SELECT b.*, 
             CASE 
               WHEN b.country = $1 THEN 10
               WHEN $2::text[] && b.brics_countries THEN 5
               ELSE 0
             END as match_score
      FROM businesses b
      WHERE b.is_active = true
      AND ($3::text IS NULL OR b.business_type = $3)
      AND ($2::text[] && b.brics_countries OR b.country = $1)
      ORDER BY match_score DESC
      LIMIT 20
    `;

    const matchResult = await db.query(matchQuery, [
      opportunity.country,
      [opportunity.country],
      opportunity.category
    ]);

    res.json({
      success: true,
      opportunity: opportunity,
      matches: matchResult.rows,
      match_count: matchResult.rows.length
    });

  } catch (error) {
    console.error('Erro ao gerar matches:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ==================== DASHBOARD ====================

// DASHBOARD COMPLETO (PROTEGIDO)
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Serviço de banco de dados indisponível'
    });
  }

  try {
    // Estatísticas de empresas
    const businessesStats = await db.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE country = $1) as from_user_country FROM businesses WHERE is_active = true',
      [req.user.country]
    );

    // Estatísticas de oportunidades
    const opportunitiesStats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE type = 'offer') as offers,
        COUNT(*) FILTER (WHERE type = 'demand') as demands,
        COUNT(*) FILTER (WHERE country = $1) as from_user_country
      FROM opportunities 
      WHERE status = 'active'
    `, [req.user.country]);

    // Oportunidades por categoria
    const opportunitiesByCategory = await db.query(`
      SELECT category, COUNT(*) as count 
      FROM opportunities 
      WHERE status = 'active' 
      GROUP BY category 
      ORDER BY count DESC 
      LIMIT 10
    `);

    // Empresas por país
    const businessesByCountry = await db.query(`
      SELECT country, COUNT(*) as count 
      FROM businesses 
      WHERE is_active = true 
      GROUP BY country 
      ORDER BY count DESC 
      LIMIT 10
    `);

    res.json({
      success: true,
      dashboard: {
        user: {
          id: req.user.userId,
          email: req.user.email
        },
        businesses: {
          total: parseInt(businessesStats.rows[0].total),
          from_user_country: parseInt(businessesStats.rows[0].from_user_country),
          by_country: businessesByCountry.rows
        },
        opportunities: {
          total: parseInt(opportunitiesStats.rows[0].total),
          offers: parseInt(opportunitiesStats.rows[0].offers),
          demands: parseInt(opportunitiesStats.rows[0].demands),
          from_user_country: parseInt(opportunitiesStats.rows[0].from_user_country),
          by_category: opportunitiesByCategory.rows
        },
        platform: {
          countries_supported: BRICS_PLUS_COUNTRIES.length,
          categories_available: OPPORTUNITY_CATEGORIES.length
        }
      }
    });

  } catch (error) {
    console.error('Erro ao buscar dashboard:', error);
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
  console.log(`💼 Categorias: ${OPPORTUNITY_CATEGORIES.length} categorias`);
  console.log(`🔐 Sistema de autenticação: ✅ PRONTO`);
  console.log(`🏢 Sistema de empresas: ✅ PRONTO`);
  console.log(`💼 Sistema de oportunidades: ✅ PRONTO`);
  console.log(`🤝 Sistema de matches: ✅ PRONTO`);
  console.log(`📊 Dashboard: ✅ PRONTO`);
});
