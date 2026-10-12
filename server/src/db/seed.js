import bcrypt from 'bcrypt';
import { connect, timestamps } from './mongodb.js';

async function seed() {
  try {
    console.log('🌱 Starting database seed...\n');

    // Production safety guard
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED_IN_PRODUCTION !== 'true') {
      console.error('❌ Refusing to run destructive seed in production without ALLOW_SEED_IN_PRODUCTION=true!');
      process.exit(1);
    }

    const db = await connect();

    // Clear existing data
    console.log('🗑️  Clearing existing collections...');
    const collections = await db.listCollections().toArray();
    for (const collection of collections) {
      await db.collection(collection.name).deleteMany({});
      console.log(`   Cleared: ${collection.name}`);
    }

    // 1. Seed Roles
    console.log('\n📝 Creating roles...');
    const roles = await db.collection('roles').insertMany([
      {
        _id: 1,
        name: 'admin',
        description: 'Full system access',
        permissions: ['*'],
        ...timestamps()
      },
      {
        _id: 2,
        name: 'cashier',
        description: 'Can manage orders and sales',
        permissions: ['orders:read', 'orders:write', 'sales:read', 'sales:write'],
        ...timestamps()
      },
      {
        _id: 3,
        name: 'rider',
        description: 'Can view assigned deliveries',
        permissions: ['deliveries:read'],
        ...timestamps()
      }
    ]);
    console.log(`   ✅ Created ${roles.insertedCount} roles`);

    // 2. Seed Default Admin User
    console.log('\n👤 Creating default admin user...');
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'admin123';
    const adminPasswordHash = await bcrypt.hash(initialPassword, 10);
    const adminUser = await db.collection('users').insertOne({
      username: 'admin',
      password_hash: adminPasswordHash,
      full_name: 'Ju Kitchen Admin',
      email: process.env.ADMIN_INITIAL_EMAIL || null,
      phone: '',
      role_id: 1,
      is_active: true,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
      ...timestamps()
    });
    console.log(`   ✅ Admin user created (ID: ${adminUser.insertedId})`);
    console.log(`   Username: admin`);
    console.log(`   Password: ${initialPassword}`);

    // 3. Seed Categories
    console.log('\n🍽️  Creating product categories...');
    const categories = await db.collection('categories').insertMany([
      { name: 'Rice Meals', description: 'Complete meals with rice', ...timestamps() },
      { name: 'Viands', description: 'Side dishes and main courses', ...timestamps() },
      { name: 'Drinks', description: 'Beverages and refreshments', ...timestamps() },
      { name: 'Add-ons', description: 'Extra items and sides', ...timestamps() },
      { name: 'Desserts', description: 'Sweet treats', ...timestamps() },
      { name: 'Breakfast Items', description: 'Morning meals', ...timestamps() },
      { name: 'Snacks', description: 'Light bites and merienda', ...timestamps() },
      { name: 'Special Orders', description: 'Party trays and bulk orders', ...timestamps() }
    ]);
    console.log(`   ✅ Created ${categories.insertedCount} categories`);

    // Get category IDs
    const categoryDocs = await db.collection('categories').find({}).toArray();
    const riceMealsId = categoryDocs.find(c => c.name === 'Rice Meals')._id;
    const viandsId = categoryDocs.find(c => c.name === 'Viands')._id;
    const drinksId = categoryDocs.find(c => c.name === 'Drinks')._id;
    const addOnsId = categoryDocs.find(c => c.name === 'Add-ons')._id;
    const dessertsId = categoryDocs.find(c => c.name === 'Desserts')._id;
    const breakfastId = categoryDocs.find(c => c.name === 'Breakfast Items')._id;
    const snacksId = categoryDocs.find(c => c.name === 'Snacks')._id;
    const specialId = categoryDocs.find(c => c.name === 'Special Orders')._id;

    // 4. Seed Products (with explicit is_active: true)
    console.log('\n🍴 Creating products...');
    const products = await db.collection('products').insertMany([
      // Rice Meals
      { category_id: riceMealsId, name: 'Adobo Rice', description: 'Filipino chicken adobo with rice', price_centavos: 7500, is_available: true, is_active: true, photo_path: null, ...timestamps() },
      { category_id: riceMealsId, name: 'Sinigang Rice', description: 'Sour tamarind soup with rice', price_centavos: 8000, is_available: true, is_active: true, photo_path: null, ...timestamps() },
      { category_id: riceMealsId, name: 'Lechon Kawali Rice', description: 'Crispy pork belly with rice', price_centavos: 9500, is_available: true, is_active: true, photo_path: null, ...timestamps() },

      // Viands
      { category_id: viandsId, name: 'Pork BBQ Skewers', description: '3 pieces', price_centavos: 4500, is_available: true, is_active: true, photo_path: null, ...timestamps() },
      { category_id: viandsId, name: 'Lumpiang Shanghai', description: '5 pieces spring rolls', price_centavos: 6000, is_available: true, is_active: true, photo_path: null, ...timestamps() },

      // Drinks
      { category_id: drinksId, name: 'Iced Tea', description: '16oz', price_centavos: 2500, is_available: true, is_active: true, photo_path: null, ...timestamps() },
      { category_id: drinksId, name: 'Bottled Water', description: '500ml', price_centavos: 1500, is_available: true, is_active: true, photo_path: null, ...timestamps() },

      // Add-ons
      { category_id: addOnsId, name: 'Extra Rice', description: 'Plain white rice', price_centavos: 2000, is_available: true, is_active: true, photo_path: null, ...timestamps() },
      { category_id: addOnsId, name: 'Extra Gravy', description: 'Savory sauce', price_centavos: 1000, is_available: true, is_active: true, photo_path: null, ...timestamps() },

      // Desserts
      { category_id: dessertsId, name: 'Halo-Halo', description: 'Filipino mixed dessert', price_centavos: 6500, is_available: true, is_active: true, photo_path: null, ...timestamps() },

      // Breakfast
      { category_id: breakfastId, name: 'Tapsilog', description: 'Beef tapa, egg, and rice', price_centavos: 8500, is_available: true, is_active: true, photo_path: null, ...timestamps() },
      { category_id: breakfastId, name: 'Tocilog', description: 'Sweet pork, egg, and rice', price_centavos: 8500, is_available: true, is_active: true, photo_path: null, ...timestamps() },

      // Snacks
      { category_id: snacksId, name: 'Banana Cue', description: 'Caramelized banana on stick', price_centavos: 3000, is_available: true, is_active: true, photo_path: null, ...timestamps() },
      { category_id: snacksId, name: 'Palabok', description: 'Rice noodles with shrimp sauce', price_centavos: 7000, is_available: true, is_active: true, photo_path: null, ...timestamps() },

      // Special Orders
      { category_id: specialId, name: 'Party Tray Pancit', description: 'Good for 10-15 persons', price_centavos: 50000, is_available: true, is_active: true, photo_path: null, ...timestamps() }
    ]);
    console.log(`   ✅ Created ${products.insertedCount} products`);

    // 5. Seed Delivery Zones (Marilao, Bulacan service area)
    console.log('\n📍 Creating delivery zones (Marilao, Bulacan)...');
    const zones = await db.collection('delivery_zones').insertMany([
      { name: 'Marilao - Zone 1 (Saog & Poblacion)', fee_centavos: 3500, min_order_centavos: 0, estimated_minutes: 15, sort_order: 1, is_active: true, ...timestamps() },
      { name: 'Marilao - Zone 2 (Lias & Ibayo)', fee_centavos: 4500, min_order_centavos: 0, estimated_minutes: 20, sort_order: 2, is_active: true, ...timestamps() },
      { name: 'Marilao - Zone 3 (Sta. Rosa & Abangan)', fee_centavos: 5500, min_order_centavos: 0, estimated_minutes: 25, sort_order: 3, is_active: true, ...timestamps() },
      { name: 'Meycauayan City (Border area)', fee_centavos: 7000, min_order_centavos: 25000, estimated_minutes: 35, sort_order: 4, is_active: true, ...timestamps() },
      { name: 'Bocaue (Border area)', fee_centavos: 8000, min_order_centavos: 30000, estimated_minutes: 40, sort_order: 5, is_active: true, ...timestamps() }
    ]);
    console.log(`   ✅ Created ${zones.insertedCount} delivery zones`);

    // 6. Seed Settings (Aligned with Marilao, Bulacan shop location)
    console.log('\n⚙️  Creating system settings...');
    const settings = await db.collection('settings').insertMany([
      { key: 'shop_latitude', value: '14.763649', group_name: 'location', description: 'Shop latitude coordinate (Marilao, Bulacan)', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'shop_longitude', value: '120.956218', group_name: 'location', description: 'Shop longitude coordinate (Marilao, Bulacan)', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'tax_rate', value: '12', group_name: 'finance', description: 'VAT percentage', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'test_mode', value: 'false', group_name: 'general', description: 'Test transaction mode', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'business_name', value: 'Ju Kitchen', group_name: 'general', description: 'Business name', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'business_phone', value: '09000000000', group_name: 'general', description: 'Contact phone', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'business_address', value: 'Saog, Marilao, Bulacan, Philippines', group_name: 'general', description: 'Business address', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'timezone', value: 'Asia/Manila', group_name: 'general', description: 'Business timezone', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'currency', value: 'PHP', group_name: 'finance', description: 'Currency code', updated_by: adminUser.insertedId, ...timestamps() },
      { key: 'require_gcash_proof', value: 'true', group_name: 'payment', description: 'Always require GCash proof screenshot', updated_by: adminUser.insertedId, ...timestamps() }
    ]);
    console.log(`   ✅ Created ${settings.insertedCount} settings`);

    // 7. Seed Sample Riders
    console.log('\n🏍️  Creating sample riders...');
    const riders = await db.collection('riders').insertMany([
      { full_name: 'Juan Dela Cruz', phone: '09171234567', vehicle_type: 'motorcycle', plate_no: 'ABC-1234', is_available: true, is_active: true, notes: 'Marilao area specialist', ...timestamps() },
      { full_name: 'Pedro Santos', phone: '09181234567', vehicle_type: 'motorcycle', plate_no: 'DEF-5678', is_available: true, is_active: true, notes: null, ...timestamps() },
      { full_name: 'Maria Garcia', phone: '09191234567', vehicle_type: 'bicycle', plate_no: null, is_available: true, is_active: true, notes: 'Short-range Saog deliveries', ...timestamps() }
    ]);
    console.log(`   ✅ Created ${riders.insertedCount} riders`);

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Database seed completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📊 Summary:');
    console.log(`   Roles: ${roles.insertedCount}`);
    console.log(`   Users: 1 admin`);
    console.log(`   Categories: ${categories.insertedCount}`);
    console.log(`   Products: ${products.insertedCount}`);
    console.log(`   Delivery Zones: ${zones.insertedCount}`);
    console.log(`   Settings: ${settings.insertedCount}`);
    console.log(`   Riders: ${riders.insertedCount}`);
    console.log('\n🔑 Login Credentials:');
    console.log('   Username: admin');
    console.log(`   Password: ${initialPassword}`);
    console.log('   Location: Saog, Marilao, Bulacan (14.763649, 120.956218)');
    console.log('\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }
}

seed();
