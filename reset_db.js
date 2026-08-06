const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/grid_bot?schema=public';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
});

async function resetBotState() {
  console.log(`🧹 Reiniciando estado del bot en PostgreSQL...`);
  console.log(`URL DB: ${dbUrl}`);

  await prisma.order.deleteMany({});
  await prisma.gridLevel.deleteMany({});
  await prisma.botConfig.deleteMany({});

  console.log('✅ Estado del bot reiniciado a CERO exitosamente (órdenes, niveles y configs borrados).');
  await prisma.$disconnect();
}

resetBotState().catch((err) => {
  console.error('❌ Error reiniciando la base de datos:', err);
  process.exit(1);
});
