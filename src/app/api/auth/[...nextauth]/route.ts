import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AdminRow {
  id:            string;
  email:         string;
  password_hash: string;
  name:          string | null;
}

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',          type: 'email'    },
        password: { label: 'Mot de passe',   type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const { data, error } = await supabase
          .from('admins')
          .select('id, email, password_hash, name')
          .eq('email', credentials.email.toLowerCase().trim())
          .single();

        if (error || !data) return null;

        const admin    = data as AdminRow;
        const isValid  = await bcrypt.compare(credentials.password, admin.password_hash);
        if (!isValid) return null;

        return {
          id:    admin.id,
          email: admin.email,
          name:  admin.name ?? admin.email,
        };
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge:   24 * 60 * 60, // 24h
  },

  pages: {
    signIn: '/login',
  },

  secret: process.env.NEXTAUTH_SECRET,

  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
});

export { handler as GET, handler as POST };
