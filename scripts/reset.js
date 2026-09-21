/** Xoá sạch cơ sở dữ liệu và nạp lại từ đầu. */
import fs from 'node:fs';
import { config } from '../src/config.js';

for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.dbPath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`Đã xoá ${file}`);
  }
}
console.log('Xong. Chạy `npm run seed` để nạp lại dữ liệu mẫu.');
