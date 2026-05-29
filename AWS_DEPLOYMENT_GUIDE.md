# AWS Deployment Guide — SPX/GEX Dashboard

**Goal:** Move dashboard to AWS without touching current local setup. Once 100% working on AWS, cutover.

---

## Phase 1: AWS Account & Free Tier Setup

1. **Create AWS Account**
   - Go to aws.amazon.com, sign up
   - Add payment method (won't be charged during free tier)
   - Enable billing alerts: AWS Console → Billing → Budget Alerts (set to $1)

2. **Verify Payment**
   - AWS will verify your card with a small charge (~$1), then refund it
   - This can take 1–2 business days
   - **Wait until verified before proceeding**

---

## Phase 2: Set Up Backend Infrastructure (Parallel to Local)

### 2.1 Create EC2 Instance (Free Tier)

1. AWS Console → EC2 → Instances → Launch Instance
2. **Configuration:**
   - Name: `spx-gex-backend`
   - AMI: Ubuntu 22.04 LTS (Free Tier eligible)
   - Instance Type: `t2.micro` (Free Tier)
   - Key Pair: Create new → download `.pem` file → **save securely**
   - Security Group: Create new
     - Allow SSH (port 22) from your IP only
     - Allow HTTP (port 80) from anywhere
     - Allow HTTPS (port 443) from anywhere
   - Storage: 30 GB (Free Tier limit)
   - Launch

3. **Wait for instance to start** (2–3 minutes)
4. Copy the **Public IPv4 address** (e.g., `54.123.45.67`)

### 2.2 Connect to EC2 & Install Node.js

```bash
# On your local machine (macOS/Linux/WSL)
chmod 400 ~/path/to/your-key.pem
ssh -i ~/path/to/your-key.pem ubuntu@54.123.45.67

# On the EC2 instance:
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs npm

# Verify
node -v && npm -v
```

### 2.3 Create Backend Directory Structure

```bash
# On EC2 instance
mkdir -p ~/spx-gex-api/src
cd ~/spx-gex-api
npm init -y
npm install express dotenv cors body-parser node-fetch bcryptjs jsonwebtoken
touch .env src/server.js src/auth.js
```

---

## Phase 3: Build Backend on AWS (Non-Destructive)

### 3.1 Create `.env` on EC2

```bash
# ~/.env (on EC2)
PORT=3000
NODE_ENV=production
TT_PROXY_URL=http://localhost:3001
JWT_SECRET=your-super-secret-key-min-32-chars
DB_TYPE=memory
ADMIN_PASSWORD=temporary-password-change-this
```

### 3.2 Create `src/server.js` on EC2

```javascript
// src/server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory user (temporary, no DB yet)
const users = {
  admin: { password: process.env.ADMIN_PASSWORD }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Login endpoint (stub)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === process.env.ADMIN_PASSWORD) {
    return res.json({ token: 'temp-token-123', ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// Proxy to local TT proxy (for now)
app.get('/api/tt/chains/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const resp = await fetch(`${process.env.TT_PROXY_URL}/proxy/api/tt/chains/${ticker}`);
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
```

### 3.3 Create `src/auth.js` on EC2

```javascript
// src/auth.js (stub for later)
const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
```

### 3.4 Test Backend Locally on EC2

```bash
cd ~/spx-gex-api
node src/server.js
# Should output: Backend running on port 3000
# Ctrl+C to stop
```

---

## Phase 4: Set Up Frontend on AWS (S3 + CloudFront)

### 4.1 Create S3 Bucket

1. AWS Console → S3 → Create bucket
2. **Configuration:**
   - Bucket name: `spx-gex-dashboard-prod` (must be globally unique)
   - Region: `us-east-1`
   - Block all public access: **UNCHECKED** (for website hosting)
   - Create bucket

### 4.2 Upload Frontend Files

```bash
# On your local machine
aws s3 cp ~/path/to/spx-gex-dashboard-tt-fixed/index.html s3://spx-gex-dashboard-prod/
aws s3 cp ~/path/to/spx-gex-dashboard-tt-fixed/shared/ s3://spx-gex-dashboard-prod/shared/ --recursive
aws s3 cp ~/path/to/spx-gex-dashboard-tt-fixed/pages/ s3://spx-gex-dashboard-prod/pages/ --recursive
```

### 4.3 Enable S3 Static Website Hosting

1. S3 → bucket → Properties → Static website hosting → Edit
2. Enable static website hosting
3. Index document: `index.html`
4. Error document: `index.html` (for SPA routing)
5. Save

### 4.4 Create S3 Bucket Policy (Allow Public Read)

1. S3 → bucket → Permissions → Bucket policy → Edit
2. Paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::spx-gex-dashboard-prod/*"
    }
  ]
}
```

3. Save

### 4.5 Test S3 Website

- S3 → bucket → Properties → Static website hosting
- Copy the endpoint (e.g., `http://spx-gex-dashboard-prod.s3-website-us-east-1.amazonaws.com`)
- Open in browser → should see dashboard shell

---

## Phase 5: Connect Frontend to Backend

### 5.1 Update Frontend for AWS Backend

Create a new file `shared/aws-api.js` (don't modify existing files):

```javascript
// shared/aws-api.js
const AWS_BACKEND = 'http://54.123.45.67:3000'; // Replace with your EC2 public IP

window.AwsApi = {
  async login(username, password) {
    const res = await fetch(`${AWS_BACKEND}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    return res.json();
  },

  async fetchChains(ticker, token) {
    const res = await fetch(`${AWS_BACKEND}/api/tt/chains/${ticker}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  }
};
```

### 5.2 Add Login Page (New File)

Create `pages/login.html` (don't modify existing overview):

```html
<!-- pages/login.html -->
<div id="login-page" style="display:flex;align-items:center;justify-content:center;height:100%;background:#0a0f16">
  <div style="background:#050810;border:1px solid #1a2a3a;padding:40px;border-radius:4px;width:300px">
    <h2 style="color:#00e5ff;margin-bottom:20px;text-align:center">Login</h2>
    <input id="username" type="text" placeholder="Username" style="width:100%;padding:8px;margin-bottom:10px;background:#070c14;border:1px solid #1a2a3a;color:#fff">
    <input id="password" type="password" placeholder="Password" style="width:100%;padding:8px;margin-bottom:20px;background:#070c14;border:1px solid #1a2a3a;color:#fff">
    <button onclick="handleLogin()" style="width:100%;padding:10px;background:#0d3a5c;border:1px solid #00b4d8;color:#00e5ff;cursor:pointer;font-weight:700">Login</button>
    <div id="login-error" style="color:#ff5252;font-size:12px;margin-top:10px;display:none"></div>
  </div>

  <script>
    async function handleLogin() {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      const result = await window.AwsApi.login(username, password);
      if (result.ok) {
        localStorage.setItem('awsToken', result.token);
        // Redirect to dashboard
        window.location.href = '/index.html';
      } else {
        document.getElementById('login-error').textContent = result.error;
        document.getElementById('login-error').style.display = 'block';
      }
    }
  </script>
</div>
```

### 5.3 Update index.html to Check Token

In `index.html`, add at the very top before any content:

```html
<script>
  const token = localStorage.getItem('awsToken');
  if (!token) {
    window.location.href = '/pages/login.html';
  }
</script>
```

---

## Phase 6: Test Full Flow

1. **On EC2 instance:**
   ```bash
   cd ~/spx-gex-api
   npm install -g pm2
   pm2 start src/server.js --name backend
   pm2 save
   ```

2. **Open S3 website URL** in browser
3. Should redirect to login page
4. Login with `admin` / `temporary-password-change-this`
5. Should load dashboard

---

## Phase 7: Cutover (When Ready)

Once everything works on AWS:

1. Update DNS (or just share S3 URL)
2. Keep local setup running as backup
3. Monitor AWS CloudWatch for errors
4. If issues, roll back to local

---

## Important Notes

- **EC2 IP will change if you stop the instance** → create Elastic IP (free) to keep it static
- **TT Proxy still runs locally on port 3001** → EC2 backend proxies to it
- **Free tier expires after 12 months** → set billing alerts
- **No database yet** → authentication is in-memory (users reset on server restart)
- **Next phases:** RDS for user storage, per-user TT tokens, domain name, SSL cert

---

## Rollback If Needed

- Keep local dashboard running on `localhost:8080`
- If AWS breaks, just stop using S3 URL
- Local setup unaffected
