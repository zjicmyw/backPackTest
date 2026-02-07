module.exports = {
  apps: [
    {
      name: 'backpack-balance',
      script: './balance-rebalancer.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/backpack-balance-error.log',
      out_file: './logs/backpack-balance-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
