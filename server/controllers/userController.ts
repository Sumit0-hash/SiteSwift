import { Request, Response } from "express";
import prisma from "../lib/prisma.js";
import openai from "../configs/openai.js";
import Stripe from "stripe";

// Get User Credits
export const getUserCredits = async (req: Request, res: Response) => {
  try {
    const userId = req.userId; // from middleware
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized user" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    return res.json({ credits: user?.credits ?? 0 });
  } catch (error: any) {
    console.log(error.code || error.message);
    return res.status(500).json({ message: error.message });
  }
};

// Controller function to create new project
export const createUserProject = async (req: Request, res: Response) => {
  const userId = req.userId;

  try {
    const { initial_prompt } = req.body as { initial_prompt?: string };

    if (!userId) return res.status(401).json({ message: "Unauthorized user" });
    if (!initial_prompt?.trim()) return res.status(400).json({ message: "initial_prompt is required" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, credits: true },
    });

    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.credits < 5) return res.status(403).json({ message: "Add credits to create more projects" });

    const project = await prisma.websiteProject.create({
      data: {
        name: initial_prompt.length > 50 ? initial_prompt.substring(0, 47) + "..." : initial_prompt,
        initial_prompt,
        userId,
      },
      select: { id: true },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { totalCreation: { increment: 1 } },
    });

    await prisma.conversation.create({
      data: { role: "user", content: initial_prompt, projectId: project.id },
    });

    // Deduct credits now (or you can deduct only after success — see note below)
    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: 5 } },
    });

    // ✅ respond immediately so frontend can navigate to project page
    res.json({ projectId: project.id });

    // ✅ run generation in background (don’t await)
    void (async () => {
      try {
        // 1) enhance prompt
        const promptEnhanceResponse = await openai.chat.completions.create({
          model: "z-ai/glm-4.5-air:free",
          messages: [
            {
              role: "system",
              content:
                `You are a prompt enhancement specialist. Take the user's website request and expand it into a detailed, comprehensive prompt... Return ONLY the enhanced prompt.`,
            },
            { role: "user", content: initial_prompt },
          ],
        });

        const enhancedPrompt = promptEnhanceResponse.choices[0].message.content?.trim() || initial_prompt;

        await prisma.conversation.create({
          data: { role: "assistant", content: `I've enhanced your prompt to: "${enhancedPrompt}"`, projectId: project.id },
        });

        await prisma.conversation.create({
          data: { role: "assistant", content: "now generating your website...", projectId: project.id },
        });

        // 2) generate code
        const codeGenerationResponse = await openai.chat.completions.create({
          model: "z-ai/glm-4.5-air:free",
          messages: [
            {
              role: "system",
              content: `You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${enhancedPrompt}" ... Output HTML ONLY.`,
            },
            { role: "user", content: enhancedPrompt },
          ],
        });

        const raw = codeGenerationResponse.choices[0].message.content || "";
        const cleaned = raw
          .replace(/```[a-z]*\n?/gi, "")
          .replace(/```$/g, "")
          .trim();

        if (!cleaned) {
          await prisma.conversation.create({
            data: { role: "assistant", content: "Unable to create the code. Please try again.", projectId: project.id },
          });

          // refund credits if generation failed
          await prisma.user.update({
            where: { id: userId },
            data: { credits: { increment: 5 } },
          });
          return;
        }

        // 3) create version + update project current_code
        const version = await prisma.version.create({
          data: { code: cleaned, description: "Initial Version", projectId: project.id },
          select: { id: true },
        });

        await prisma.websiteProject.update({
          where: { id: project.id },
          data: { current_code: cleaned, current_version_index: version.id },
        });

        await prisma.conversation.create({
          data: { role: "assistant", content: "I've created your website! You can now preview it and request changes.", projectId: project.id },
        });
      } catch (e: any) {
        console.log("Background generation failed:", e?.code || e?.message);

        // refund credits if background fails
        await prisma.user.update({
          where: { id: userId },
          data: { credits: { increment: 5 } },
        }).catch(() => {});
      }
    })();

    return;
  } catch (error: any) {
    console.log(error.code || error.message);
    return res.status(500).json({ message: error.message });
  }
};


// Controller Function to get a single User Project
export const getUserProject = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized user" });
    }

    const { projectId } = req.params;

    const project = await prisma.websiteProject.findUnique({
      where: { id: projectId, userId },
      include: {
        conversation: { orderBy: { timestamp: "asc" } },
        versions: { orderBy: { timestamp: "asc" } },
      },
    });

    return res.json({ project });
  } catch (error: any) {
    console.log(error.code || error.message);
    return res.status(500).json({ message: error.message });
  }
};

// Controller Function to get all Users Projects
export const getUserProjects = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized user" });
    }

    const projects = await prisma.websiteProject.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    return res.json({ projects });
  } catch (error: any) {
    console.log(error.code || error.message);
    return res.status(500).json({ message: error.message });
  }
};

// Controller Function to Toggle Project Publish
export const togglePublish = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized user" });
    }

    const { projectId } = req.params;

    const project = await prisma.websiteProject.findUnique({
      where: { id: projectId, userId },
      select: { id: true, isPublished: true },
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    await prisma.websiteProject.update({
      where: { id: projectId },
      data: { isPublished: !project.isPublished },
    });

    return res.json({
      message: project.isPublished ? "Project Unpublished" : "Project Published Successfully",
    });
  } catch (error: any) {
    console.log(error.code || error.message);
    return res.status(500).json({ message: error.message });
  }
};

// Controller Function to Purchase Credits.
export const purchaseCredits = async (req: Request, res: Response) => {
  try {
    const plans = {
      basic: { credits: 100, amount: 5 },
      pro: { credits: 400, amount: 19 },
      enterprise: { credits: 1000, amount: 49 },
    } as const;

    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized user" });

    const { planId } = req.body as { planId: keyof typeof plans };
    const origin = req.headers.origin as string;

    const plan = plans[planId];
    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    // Create transaction linked to user (prevents FK issues)
    const transaction = await prisma.transaction.create({
      data: {
        planId,
        amount: plan.amount,
        credits: plan.credits,
        user: { connect: { id: userId } },
      },
      select: { id: true, amount: true },
    });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

    const session = await stripe.checkout.sessions.create({
      success_url: `${origin}/loading`,
      cancel_url: `${origin}`,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `SiteSwift - ${plan.credits} Credits` },
            unit_amount: Math.floor(transaction.amount) * 100,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      metadata: {
        transactionId: transaction.id,
        appId: "siteSwift",
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
    });

    return res.json({ payment_link: session.url });
  } catch (error: any) {
    console.log(error.code || error.message);
    return res.status(500).json({ message: error.message });
  }
};
