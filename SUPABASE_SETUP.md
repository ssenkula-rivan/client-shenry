# SUPABASE SETUP GUIDE

## CRITICAL: You MUST set up Supabase to deploy to production

The app is failing to deploy because Render's Linux environment is incompatible with sqlite3. The solution is to use Supabase (cloud database) for production.

## Step 1: Get Your Supabase Credentials

1. Go to https://supabase.com
2. Sign in or create an account
3. Create a new project (or use existing)
4. Go to Project Settings → API
5. Copy these two values:
   - **Project URL** (starts with https://xxx.supabase.co)
   - **anon public key** (starts with eyJ...)

## Step 2: Set Environment Variables in Render

1. Go to your Render dashboard
2. Click on your service
3. Go to "Environment" tab
4. Add these environment variables:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=eyJ...your-anon-key-here
NODE_ENV=production
```

## Step 3: Create Database Tables in Supabase

1. In your Supabase dashboard, go to SQL Editor
2. Run this SQL to create the required tables:

```sql
-- Settings Table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Leads Table  
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT,
    email TEXT,
    platform TEXT,
    reason TEXT,
    score INTEGER DEFAULT 0,
    status TEXT DEFAULT 'new',
    stage TEXT DEFAULT 'First Contact',
    value TEXT,
    avatar TEXT,
    action TEXT,
    emailDraft TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Email Logs Table
CREATE TABLE IF NOT EXISTS email_logs (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES leads(id),
    lead_name TEXT,
    lead_email TEXT,
    subject TEXT,
    body TEXT,
    sent_at TIMESTAMP DEFAULT NOW(),
    opened_at TIMESTAMP,
    replied_at TIMESTAMP
);

-- Chat History Table
CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES
('niche', 'NGOs and social enterprises in East Africa'),
('daily_quota', '10'),
('anthropic_api_key', ''),
('sendgrid_api_key', ''),
('smtp_host', 'smtp.gmail.com'),
('smtp_port', '587'),
('smtp_user', ''),
('smtp_pass', ''),
('email_sender', 'henry@brandcraft.ug'),
('email_sender_name', 'Henry | BrandCraft'),
('auto_send', 'false'),
('backend_url', '')
ON CONFLICT (key) DO NOTHING;
```

## Step 4: Redeploy

Once you've added the environment variables in Render, the app will automatically redeploy and use Supabase instead of sqlite3.

## Test the Setup

After deployment, your app should:
1. Start without GLIBC errors
2. Show "CLIENTAGENT: Cloud Database Active (Supabase Mode)" in logs
3. Work normally with all features