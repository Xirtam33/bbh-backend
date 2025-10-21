require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

console.log('✅ Servidor iniciando...');

// Rota raiz - SIMPLES
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 BBH Backend API - BRICS Business Hub',
    timestamp: new Date().toISOString()
  });
});

// Health Check - SIMPLES
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '✅ API Online - Modo Debug',
    timestamp: new Date().toISOString()
  });
});

// Auth Info - SIMPLES
app.get('/api/auth', (req, res) => {
  res.json({
    success: true,
    message: '🔐 Auth System - Modo Debug',
    timestamp: new Date().toISOString()
  });
});

console.log('✅ Rotas registradas...');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
