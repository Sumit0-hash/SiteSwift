import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma.js";

const trustedOrigins=process.env.TRUSTED_ORIGINS?.split(',') ||[]

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql", // or "mysql", "postgresql", ...etc
    }),
    emailAndPassword: { 
    enabled: true, 
  }, 
  user:{
    deleteUser:{enabled:true}
  },
  trustedOrigins,
  baseURL: process.env.BETTER_AUTH_URL!,
  secret: process.env.BETTER_AUTH_SECRET!,
  advanced:{
    cookies:{
        session_token: {
            name:'auth_session',
            attributes:{
                httpOnly: true,
                sameSite: process.env.NODE_ENV === 'production' ? 'none':'Lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/',
            }
        }
    }
  }

});