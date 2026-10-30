const { abrir } = require('./src/db');
const { criarApp } = require('./src/app');

const porta = Number(process.env.PORT) || 3000;
const app = criarApp(abrir());

app.listen(porta, () => console.log(`SGI Boxtech rodando em http://localhost:${porta}`));
