import bcrypt from 'bcrypt';

const password = process.argv[2] || 'admin123';
const saltRounds = 10;

bcrypt.hash(password, saltRounds).then(hash => {
  console.log('\n=== JuFlow Password Hash Generator ===');
  console.log('Password:', password);
  console.log('Hash:    ', hash);
  console.log('\nUsage: node generate-password.js <your_password>');
  console.log('Use this hash for user creation or set ADMIN_INITIAL_PASSWORD in .env');
  console.log('=======================================\n');
}).catch(err => {
  console.error('Error generating hash:', err);
});
