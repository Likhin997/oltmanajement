/**
 * File: src/services/sourceCodeModules.ts
 * Menyimpan kode sumber utuh (Modul 1 s/d Modul 4) agar engineer dapat menginspeksi
 * atau mengunduh langsung dari dalam aplikasi SmartOLT GPON Manager.
 */

export interface CodeModuleFile {
  moduleNumber: 1 | 2 | 3 | 4;
  fileName: string;
  language: 'sql' | 'javascript' | 'typescript' | 'bash';
  description: string;
  code: string;
}

export const PRODUCTION_CODE_MODULES: CodeModuleFile[] = [
  {
    moduleNumber: 1,
    fileName: 'config/database.js',
    language: 'javascript',
    description: 'Koneksi Pool MySQL / MariaDB (mysql2/promise) dengan Auto-Reconnect & Transaction Helper',
    code: `// File: config/database.js
// Modul 1: Konfigurasi Koneksi Database MySQL / MariaDB (Node.js Express Production)

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const dbPool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smartolt_db',
  waitForConnections: true,
  connectionLimit: 25,
  queueLimit: 0,
  timezone: '+07:00',
  decimalNumbers: true,
});

/**
 * Helper eksekusi query aman dengan Prepared Statement
 */
export async function querySql(sql, params = []) {
  const [rows] = await dbPool.execute(sql, params);
  return rows;
}

/**
 * Helper transaksi database atomik (Commit / Rollback otomatis)
 */
export async function withTransaction(callback) {
  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
`,
  },
  {
    moduleNumber: 2,
    fileName: 'services/OltTelnetSshEngine.js',
    language: 'javascript',
    description: 'Engine Koneksi Telnet/SSH & SNMP ke ZTE C320/C300 (Handle Prompt Username:, Password:, #, (config)#, --More--)',
    code: `// File: services/OltTelnetSshEngine.js
// Modul 2A: Engine Koneksi Telnet/SSH & SNMP untuk OLT ZTE C320 / C300

import net from 'net';

export class OltTelnetSshEngine {
  /**
   * @param {Object} oltConfig
   * @param {string} oltConfig.ip_address
   * @param {number} oltConfig.telnet_port
   * @param {string} oltConfig.olt_username
   * @param {string} oltConfig.olt_password
   * @param {string} [oltConfig.enable_password]
   * @param {number} [oltConfig.timeoutMs=12000]
   */
  constructor(oltConfig) {
    this.host = oltConfig.ip_address;
    this.port = Number(oltConfig.telnet_port || 23);
    this.username = oltConfig.olt_username;
    this.password = oltConfig.olt_password;
    this.enablePassword = oltConfig.enable_password || 'zxr10';
    this.timeoutMs = oltConfig.timeoutMs || 12000;
    this.socket = null;
    this.buffer = '';
  }

  /**
   * Membuka sesi TCP Telnet ke OLT ZTE C320/C300 dan melakukan autentikasi otomatis
   * Menangani prompt: Username:, Password:, >, #, (config)#, dan --More--
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(this.timeoutMs);

      let authStage = 'WAIT_USERNAME';

      const onData = (chunk) => {
        const text = chunk.toString('utf8');
        this.buffer += text;

        // Tangani paginasi --More-- otomatis dengan mengirim karakter spasi
        if (this.buffer.includes('--More--')) {
          this.buffer = this.buffer.replace(/--More--/g, '');
          this.socket.write(' ');
          return;
        }

        if (authStage === 'WAIT_USERNAME' && /(?:Username|login)\s*:/i.test(this.buffer)) {
          this.buffer = '';
          authStage = 'WAIT_PASSWORD';
          this.socket.write(this.username + '\\r\\n');
        } else if (authStage === 'WAIT_PASSWORD' && /Password\s*:/i.test(this.buffer)) {
          this.buffer = '';
          authStage = 'WAIT_PROMPT';
          this.socket.write(this.password + '\\r\\n');
        } else if (authStage === 'WAIT_PROMPT') {
          if (/bad password|authentication failed|login incorrect/i.test(this.buffer)) {
            this.socket.removeListener('data', onData);
            reject(new Error('Autentikasi Telnet OLT gagal: Username atau Password salah.'));
            return;
          }
          // Jika masuk ke user mode '>', eskalasi ke privileged mode 'enable'
          if (/[A-Za-z0-9_\\-]+>\\s*$/.test(this.buffer)) {
            this.buffer = '';
            authStage = 'WAIT_ENABLE';
            this.socket.write('enable\\r\\n');
          } else if (/[A-Za-z0-9_\\-]+#\\s*$/.test(this.buffer)) {
            this.buffer = '';
            this.socket.removeListener('data', onData);
            // Nonaktifkan paginasi terminal length 0 agar output panjang tidak terpotong
            this.sendCommand('terminal length 0').then(() => resolve(true)).catch(reject);
          }
        } else if (authStage === 'WAIT_ENABLE') {
          if (/Password\s*:/i.test(this.buffer)) {
            this.buffer = '';
            this.socket.write(this.enablePassword + '\\r\\n');
          } else if (/[A-Za-z0-9_\\-]+#\\s*$/.test(this.buffer)) {
            this.buffer = '';
            this.socket.removeListener('data', onData);
            this.sendCommand('terminal length 0').then(() => resolve(true)).catch(reject);
          }
        }
      };

      this.socket.on('data', onData);
      this.socket.once('timeout', () => {
        this.disconnect();
        reject(new Error(\`Koneksi Telnet ke OLT \${this.host}:\${this.port} timeout (\${this.timeoutMs}ms)\`));
      });
      this.socket.once('error', (err) => {
        this.disconnect();
        reject(err);
      });

      this.socket.connect(this.port, this.host);
    });
  }

  /**
   * Mengirim satu baris perintah CLI dan menunggu hingga prompt '#', '(config)#', atau '(config-if...)#' muncul
   */
  async sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        return reject(new Error('Socket Telnet OLT belum terhubung.'));
      }

      let cmdBuffer = '';
      const promptRegex = /[A-Za-z0-9_\\-]+(?:\\([a-z0-9_\\-/]+\\))?#\\s*$/i;
      const confirmRegex = /\\[yes\\/no\\]\\s*:|confirm\\s*\\?/i;

      const onData = (chunk) => {
        cmdBuffer += chunk.toString('utf8');

        // Jika OLT mengeluarkan prompt --More--, kirim spasi otomatis
        if (cmdBuffer.includes('--More--')) {
          cmdBuffer = cmdBuffer.replace(/--More--(\x08+|\s+)*/g, '');
          this.socket.write(' ');
          return;
        }

        // Jika OLT meminta konfirmasi [yes/no]: (misal saat reboot / restore factory)
        if (confirmRegex.test(cmdBuffer)) {
          this.socket.write('yes\\r\\n');
          return;
        }

        if (promptRegex.test(cmdBuffer)) {
          this.socket.removeListener('data', onData);
          resolve(cmdBuffer.trim());
        }
      };

      this.socket.on('data', onData);
      this.socket.write(command + '\\r\\n');
    });
  }

  /**
   * Mengeksekusi kumpulan baris perintah CLI secara berurutan (Sequential Batch Execution)
   */
  async executeScript(cliScriptText) {
    const commands = cliScriptText
      .split(/\\r?\\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('!'));

    const transcript = [];
    await this.connect();
    try {
      for (const cmd of commands) {
        const output = await this.sendCommand(cmd);
        transcript.push(\`>> \${cmd}\\n\${output}\`);
      }
    } finally {
      this.disconnect();
    }
    return transcript.join('\\n');
  }

  disconnect() {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.write('exit\\r\\n');
      } catch (_) {}
      this.socket.destroy();
    }
  }
}
`,
  },
];
