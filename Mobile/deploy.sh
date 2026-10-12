#!/bin/bash
# JuFlow Mobile Apps - Automated Deployment Script
# Deploys backend to Railway and frontend to Vercel

set -e  # Exit on error

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       JuFlow Mobile Apps - Automated Deployment             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ============================================================================
# Configuration
# ============================================================================

PROJECT_NAME="juflow-mobile"
BACKEND_DIR="backend"
MOBILE_DIR="Mobile"
REQUIRED_TOOLS=("railway" "vercel" "psql" "git")

# ============================================================================
# Helper Functions
# ============================================================================

log_step() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "▶ $1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

log_success() {
    echo "✅ $1"
}

log_error() {
    echo "❌ ERROR: $1"
    exit 1
}

log_warning() {
    echo "⚠️  WARNING: $1"
}

check_tool() {
    if ! command -v $1 &> /dev/null; then
        log_error "$1 is not installed. Install it first."
    fi
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

log_step "Step 1/10: Pre-flight Checks"

echo "Checking required tools..."
for tool in "${REQUIRED_TOOLS[@]}"; do
    check_tool $tool
    log_success "$tool found"
done

# Check if in correct directory
if [ ! -d "$MOBILE_DIR" ]; then
    log_error "Mobile directory not found. Run this script from JuFlow-UI root."
fi

log_success "All pre-flight checks passed"

# ============================================================================
# Backend Setup
# ============================================================================

log_step "Step 2/10: Backend Setup"

echo "Do you want to deploy backend to Railway? (y/n)"
read -r DEPLOY_BACKEND

if [ "$DEPLOY_BACKEND" = "y" ]; then
    
    # Check if backend code exists
    if [ ! -f "$BACKEND_DIR/main.py" ]; then
        log_warning "Backend code not found. Copying from scaffold..."
        mkdir -p $BACKEND_DIR
        cp -r $MOBILE_DIR/backend-scaffold/python-fastapi/* $BACKEND_DIR/
        log_success "Backend code copied"
    fi
    
    # Railway login
    echo "Logging into Railway..."
    railway login || log_error "Railway login failed"
    log_success "Railway login successful"
    
    # Initialize Railway project
    cd $BACKEND_DIR
    
    if [ ! -f "railway.toml" ]; then
        echo "Creating railway.toml..."
        cat > railway.toml << 'EOF'
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
EOF
        log_success "railway.toml created"
    fi
    
    # Link or create Railway project
    echo "Initializing Railway project..."
    railway init || log_warning "Railway project may already exist"
    
    # Add PostgreSQL
    echo "Adding PostgreSQL database..."
    railway add --plugin postgresql || log_warning "PostgreSQL may already exist"
    log_success "PostgreSQL configured"
    
    # Generate and set SECRET_KEY
    echo "Generating SECRET_KEY..."
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    railway variables --set SECRET_KEY="$SECRET_KEY"
    log_success "SECRET_KEY set"
    
    # Set ALLOWED_ORIGINS
    echo "Enter your frontend URL (e.g., https://juflow.vercel.app):"
    read -r FRONTEND_URL
    railway variables --set ALLOWED_ORIGINS="$FRONTEND_URL,http://localhost:8080"
    log_success "ALLOWED_ORIGINS set"
    
    cd ..
    
else
    log_warning "Skipping backend deployment"
fi

# ============================================================================
# Database Migration
# ============================================================================

log_step "Step 3/10: Database Migration"

if [ "$DEPLOY_BACKEND" = "y" ]; then
    echo "Do you want to run database migrations? (y/n)"
    read -r RUN_MIGRATIONS
    
    if [ "$RUN_MIGRATIONS" = "y" ]; then
        echo "Running migrations..."
        cd $BACKEND_DIR
        
        # Get DATABASE_URL
        DATABASE_URL=$(railway variables | grep DATABASE_URL | cut -d'=' -f2-)
        
        if [ -z "$DATABASE_URL" ]; then
            log_error "DATABASE_URL not found. Ensure PostgreSQL is added to Railway."
        fi
        
        # Run migration
        railway run psql "$DATABASE_URL" -f ../Mobile/backend-scaffold/migrations/001_phase2_support.sql || log_error "Migration failed"
        
        log_success "Database migration completed"
        cd ..
    else
        log_warning "Skipping database migration"
    fi
else
    log_warning "Skipping database migration (backend not deployed)"
fi

# ============================================================================
# Backend Deployment
# ============================================================================

log_step "Step 4/10: Backend Deployment"

if [ "$DEPLOY_BACKEND" = "y" ]; then
    echo "Deploying backend to Railway..."
    cd $BACKEND_DIR
    
    # Commit changes if needed
    if [ -n "$(git status --porcelain)" ]; then
        log_warning "Uncommitted changes detected. Committing..."
        git add .
        git commit -m "Deploy JuFlow Mobile backend - $(date -u +%Y-%m-%d)"
    fi
    
    # Deploy
    railway up || log_error "Railway deployment failed"
    
    # Get deployment URL
    BACKEND_URL=$(railway domain 2>/dev/null | head -1)
    
    if [ -z "$BACKEND_URL" ]; then
        log_warning "Could not get Railway domain. Check Railway dashboard."
        echo "Enter your Railway backend URL manually:"
        read -r BACKEND_URL
    fi
    
    log_success "Backend deployed to: $BACKEND_URL"
    
    # Save URL for frontend
    echo "$BACKEND_URL" > ../BACKEND_URL.txt
    
    cd ..
else
    log_warning "Skipping backend deployment"
    
    # Ask for backend URL if not deploying
    echo "Enter your existing backend URL:"
    read -r BACKEND_URL
    echo "$BACKEND_URL" > BACKEND_URL.txt
fi

# ============================================================================
# Test Backend
# ============================================================================

log_step "Step 5/10: Backend Health Check"

if [ -n "$BACKEND_URL" ]; then
    echo "Testing backend health endpoint..."
    
    # Wait for deployment to be ready
    echo "Waiting for backend to be ready (max 60s)..."
    for i in {1..12}; do
        if curl -sf "$BACKEND_URL/api/health" > /dev/null; then
            log_success "Backend is healthy!"
            curl -s "$BACKEND_URL/api/health" | python3 -m json.tool
            break
        else
            echo "Waiting... ($i/12)"
            sleep 5
        fi
    done
else
    log_warning "No backend URL available for health check"
fi

# ============================================================================
# Update Frontend Configuration
# ============================================================================

log_step "Step 6/10: Update Frontend Configuration"

echo "Updating frontend API configuration..."

# Update API_BASE_URL in shared/utils.js
if [ -f "$MOBILE_DIR/shared/utils.js" ]; then
    if [ -n "$BACKEND_URL" ]; then
        # Add API configuration if not present
        if ! grep -q "API_BASE_URL" "$MOBILE_DIR/shared/utils.js"; then
            cat >> "$MOBILE_DIR/shared/utils.js" << EOF

// API Configuration
const API_BASE_URL = (() => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8000';
  }
  return '$BACKEND_URL';
})();

window.API_BASE_URL = API_BASE_URL;
EOF
            log_success "API configuration added to utils.js"
        else
            log_warning "API_BASE_URL already exists in utils.js"
        fi
    fi
fi

# ============================================================================
# Frontend Deployment (Vercel)
# ============================================================================

log_step "Step 7/10: Frontend Deployment"

echo "Do you want to deploy frontend to Vercel? (y/n)"
read -r DEPLOY_FRONTEND

if [ "$DEPLOY_FRONTEND" = "y" ]; then
    
    # Vercel login
    echo "Logging into Vercel..."
    vercel login || log_error "Vercel login failed"
    log_success "Vercel login successful"
    
    # Link or create project
    echo "Linking Vercel project..."
    vercel link || log_warning "Vercel project may already be linked"
    
    # Set environment variable
    if [ -n "$BACKEND_URL" ]; then
        echo "Setting VITE_API_BASE_URL environment variable..."
        echo "$BACKEND_URL" | vercel env add VITE_API_BASE_URL production
        log_success "Environment variable set"
    fi
    
    # Deploy to production
    echo "Deploying to Vercel production..."
    vercel --prod || log_error "Vercel deployment failed"
    
    # Get deployment URL
    FRONTEND_URL=$(vercel inspect --prod 2>/dev/null | grep "URL:" | awk '{print $2}')
    
    if [ -z "$FRONTEND_URL" ]; then
        log_warning "Could not get Vercel URL. Check Vercel dashboard."
    else
        log_success "Frontend deployed to: $FRONTEND_URL"
    fi
    
else
    log_warning "Skipping frontend deployment"
fi

# ============================================================================
# Update Backend CORS (if needed)
# ============================================================================

log_step "Step 8/10: Update Backend CORS"

if [ "$DEPLOY_BACKEND" = "y" ] && [ "$DEPLOY_FRONTEND" = "y" ] && [ -n "$FRONTEND_URL" ]; then
    echo "Updating backend ALLOWED_ORIGINS with frontend URL..."
    cd $BACKEND_DIR
    railway variables --set ALLOWED_ORIGINS="$FRONTEND_URL,http://localhost:8080"
    log_success "CORS updated"
    cd ..
else
    log_warning "Skipping CORS update"
fi

# ============================================================================
# Post-Deployment Tests
# ============================================================================

log_step "Step 9/10: Post-Deployment Tests"

if [ -n "$FRONTEND_URL" ]; then
    echo "Testing frontend deployment..."
    
    echo "Cashier app:"
    curl -sI "$FRONTEND_URL/cashier/" | head -1
    
    echo "Rider app:"
    curl -sI "$FRONTEND_URL/rider/" | head -1
    
    log_success "Frontend tests complete"
fi

# ============================================================================
# Summary
# ============================================================================

log_step "Step 10/10: Deployment Summary"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                  DEPLOYMENT COMPLETE                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [ -n "$BACKEND_URL" ]; then
    echo "🔧 Backend API:      $BACKEND_URL"
    echo "   Health Check:     $BACKEND_URL/api/health"
fi

if [ -n "$FRONTEND_URL" ]; then
    echo ""
    echo "📱 Cashier App:      $FRONTEND_URL/cashier/"
    echo "📱 Rider App:        $FRONTEND_URL/rider/"
fi

echo ""
echo "Next steps:"
echo "  1. Test both apps in browser"
echo "  2. Install PWAs to home screen"
echo "  3. Run TESTING_PLAN.md procedures"
echo "  4. Configure custom domains (see VERCEL_DEPLOY.md)"
echo "  5. Set up monitoring and alerts"
echo ""

# Save deployment info
cat > DEPLOYMENT_INFO.txt << EOF
JuFlow Mobile Apps - Deployment Information
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Backend API: $BACKEND_URL
Cashier App: $FRONTEND_URL/cashier/
Rider App: $FRONTEND_URL/rider/

Health Check: $BACKEND_URL/api/health

Deployment Tools:
- Railway CLI: $(railway --version 2>/dev/null || echo "not found")
- Vercel CLI: $(vercel --version 2>/dev/null || echo "not found")

Environment:
- Backend: Railway
- Frontend: Vercel
- Database: PostgreSQL (Railway)

Access:
- Railway Dashboard: https://railway.app/
- Vercel Dashboard: https://vercel.com/dashboard

Documentation:
- RAILWAY_DEPLOY.md - Backend deployment guide
- VERCEL_DEPLOY.md - Frontend deployment guide
- TESTING_PLAN.md - Testing procedures
- MASTER_INDEX.md - Complete documentation index
EOF

log_success "Deployment info saved to DEPLOYMENT_INFO.txt"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              🎉 DEPLOYMENT SUCCESSFUL 🎉                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
