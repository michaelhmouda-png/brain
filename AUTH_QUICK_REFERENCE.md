# Brain Authentication - Developer Quick Reference

Quick guide for using authentication in Brain pages and components.

---

## Client-Side Authentication (Browser)

### In Client Components ('use client')

```typescript
'use client';

import { loginUser, logoutUser, getCurrentUser } from '@/lib/auth';

export function MyComponent() {
  const handleLogin = async (email: string, password: string) => {
    try {
      const { user, profile } = await loginUser(email, password);
      console.log('Logged in as:', user.email);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      // User is now signed out
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div>
      {/* Your JSX */}
    </div>
  );
}
```

### Available Functions

```typescript
// Sign in
await loginUser(email, password)
// Returns: { user, profile }

// Request password reset
await requestPasswordReset(email)
// Email sent to user with reset link

// Reset password (must be called from reset-password page)
await resetPassword(newPassword)

// Sign out
await logoutUser()

// Get current auth user
const user = await getCurrentUser()

// Get user profile from database
const profile = await getCurrentUserProfile()

// Get current session
const session = await getAuthSession()
```

---

## Server-Side Authentication (Next.js Server Components)

### In Server Components (default)

```typescript
import { getCurrentUserServer, getCurrentUserProfileServer, isCurrentUserSuperAdmin } from '@/lib/authServer';
import { redirect } from 'next/navigation';

export default async function MyPage() {
  // Get current user from auth
  const user = await getCurrentUserServer();
  
  if (!user) {
    redirect('/login'); // Middleware should handle this, but double-check
  }

  // Get user's profile from database
  const profile = await getCurrentUserProfileServer();
  
  if (!profile) {
    return <div>Account not set up</div>;
  }

  // Check user role
  const isSuperAdmin = await isCurrentUserSuperAdmin();

  return (
    <div>
      <h1>Welcome, {profile.full_name}</h1>
      {isSuperAdmin && <p>You are a super admin</p>}
    </div>
  );
}
```

### Available Server Functions

```typescript
// Get auth user (from Supabase Auth)
const user = await getCurrentUserServer()

// Get user profile (from database)
const profile = await getCurrentUserProfileServer()

// Get user's company ID
const companyId = await getCurrentUserCompanyId()

// Check roles
const isSuperAdmin = await isCurrentUserSuperAdmin()
const canEdit = await canCurrentUserEdit() // owner, manager, super_admin
const canAdmin = await canCurrentUserAdmin() // owner, super_admin

// Fetch data (respects RLS automatically)
const companies = await getAccessibleCompanies()
const locations = await getAccessibleLocations()
const departments = await getAccessibleDepartments()
const employees = await getAccessibleEmployees()
```

---

## Creating Protected Pages

### Server Component (Recommended)

```typescript
// app/dashboard/new-feature/page.tsx
import { redirect } from 'next/navigation';
import { getCurrentUserServer, canCurrentUserEdit } from '@/lib/authServer';

export default async function NewFeaturePage() {
  // Middleware protects /dashboard, but explicitly check in sensitive pages
  const user = await getCurrentUserServer();
  if (!user) {
    redirect('/login');
  }

  // Check permissions for specific action
  const canEdit = await canCurrentUserEdit();
  if (!canEdit) {
    return <div>You don't have permission to access this page</div>;
  }

  return (
    <div>
      <h1>New Feature</h1>
      {/* Page content */}
    </div>
  );
}
```

### Client Component (For Interactive Features)

```typescript
'use client';

import { useState, useEffect } from 'react';
import { getCurrentUser } from '@/lib/auth';

export function MyFeature() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      setIsAuthenticated(!!user);
    })();
  }, []);

  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }

  return <div>{/* Your feature */}</div>;
}
```

---

## Accessing Data with Company Isolation

### In Server Components

```typescript
import { getCurrentUserCompanyId } from '@/lib/authServer';
import { createSupabase } from '@/lib/supabaseClient';

export default async function MyPage() {
  const supabase = createSupabase();
  const companyId = await getCurrentUserCompanyId();

  // Fetch data (RLS will automatically filter by company_id)
  const { data: employees } = await supabase
    .from('employees')
    .select('*')
    .eq('company_id', companyId);

  return (
    <div>
      {employees?.map(emp => (
        <div key={emp.id}>{emp.first_name}</div>
      ))}
    </div>
  );
}
```

**Important**: The RLS policies automatically enforce company isolation. Even if a user tries to query other companies' data, they'll get no results.

---

## API Routes with Authentication

### In API Routes (app/api/route.ts)

```typescript
import { getCurrentUserServer, canCurrentUserEdit } from '@/lib/authServer';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserServer();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Your logic here
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Check if user can edit
    const canEdit = await canCurrentUserEdit();
    if (!canEdit) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Your logic here
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

---

## User Profile Structure

```typescript
type Profile = {
  id: string;                              // Matches auth.users.id
  company_id: string | null;               // User's company (null for super_admin)
  employee_id: string | null;              // Linked employee record
  full_name: string | null;                // User's full name
  role: 'super_admin' | 'owner' | 'manager' | 'employee';
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;                      // ISO timestamp
  updated_at: string;                      // ISO timestamp
};
```

---

## Role Permissions

### super_admin
- Access to ALL companies and data
- Can manage users (future phase)
- Full write access

### owner
- Access to OWN company only
- Full write access to company data
- Cannot manage users (future phase)

### manager
- Access to OWN company only
- Can create/edit operational data
- Cannot manage company settings (future phase)

### employee
- Access to OWN company only
- Read-only access initially
- Cannot create/edit (permissions in future phase)

---

## Common Patterns

### Show Login Link If Not Authenticated

```typescript
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAuthSession } from '@/lib/auth';

export function Header() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getAuthSession();
      setIsAuthenticated(!!session);
    })();
  }, []);

  return (
    <header>
      {isAuthenticated ? (
        <Link href="/dashboard">Dashboard</Link>
      ) : (
        <Link href="/login">Login</Link>
      )}
    </header>
  );
}
```

### Redirect Unauthenticated Users

```typescript
// Server component
import { redirect } from 'next/navigation';
import { getCurrentUserServer } from '@/lib/authServer';

export default async function ProtectedPage() {
  const user = await getCurrentUserServer();
  
  if (!user) {
    redirect('/login');
  }

  // Page is now protected
  return <div>Authenticated content</div>;
}
```

### Fetch User Email Safely

```typescript
// Server component
import { getCurrentUserServer } from '@/lib/authServer';

export default async function Profile() {
  const user = await getCurrentUserServer();
  const userEmail = user?.email || 'Unknown';

  return <div>Email: {userEmail}</div>;
}
```

---

## Debugging

### Check if User is Authenticated

```typescript
// Server component
const user = await getCurrentUserServer();
console.log('Authenticated user:', user?.email);

// Client component
const user = await getCurrentUser();
console.log('Auth session:', user);
```

### Check User Profile

```typescript
// Server component
const profile = await getCurrentUserProfileServer();
console.log('User profile:', profile);
// Output: { id, company_id, role, status, ... }
```

### Check RLS Policies

```typescript
// Try to fetch from client
const { data, error } = await createSupabase()
  .from('companies')
  .select('*');

if (error) {
  console.error('RLS denied access:', error);
}
```

---

## Do's and Don'ts

### ✅ DO

- Use server components by default
- Use `getCurrentUserServer()` in server components
- Use `getCurrentUserCompanyId()` when filtering by company
- Redirect to `/login` if user is not authenticated
- Check `profile.status === 'active'` for sensitive operations
- Use RLS policies for data isolation

### ❌ DON'T

- Expose `SUPABASE_SERVICE_ROLE_KEY` to client code
- Store auth tokens in local storage (use server sessions)
- Skip authentication checks on protected pages
- Trust client-side role checks (always verify on server)
- Fetch all data without company filtering
- Allow write operations from client components

---

## More Information

- [ADMIN_SETUP.md](./ADMIN_SETUP.md) - User setup guide
- [PHASE1_AUTH_SUMMARY.md](./PHASE1_AUTH_SUMMARY.md) - Complete feature summary
- [auth_schema.sql](./auth_schema.sql) - Database schema details
- [lib/auth.ts](./lib/auth.ts) - Function source code
- [lib/authServer.ts](./lib/authServer.ts) - Server function source code
