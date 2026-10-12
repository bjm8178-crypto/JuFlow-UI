import bcrypt from 'bcrypt';

const password = 'admin123';
const saltRounds = 10;

bcrypt.hash(password, saltRounds).then(hash => {
  console.log('\n=== Generated Password Hash ===');
  console.log('Password:', password);
  console.log('Hash:', hash);
  console.log('\nCopy this hash into 002_seed_data.sql to replace the placeholder.');
  console.log('================================\n');
}).catch(err => {
  console.error('Error generating hash:', err);
});
