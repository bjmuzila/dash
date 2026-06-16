import { NextRequest, NextResponse } from "next/server";
import { queryAll, getDb } from "@/lib/db";
import { execSync } from "child_process";

interface ImportRequest {
  url?: string;
  text?: string;
}

interface StructuredRecipe {
  title: string;
  ingredients: string[];
  instructions: string[];
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  image?: string;
  tags?: string[];
}

interface RecipeRecord {
  id: string;
  title: string;
  ingredients: string;
  instructions: string;
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  image?: string;
  url?: string;
  notes?: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

async function ensureRecipesTable() {
  const pool = await getDb();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL,
      instructions TEXT NOT NULL,
      prep_time TEXT,
      cook_time TEXT,
      servings TEXT,
      image TEXT,
      url TEXT,
      notes TEXT,
      tags TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes(title);
    CREATE INDEX IF NOT EXISTS idx_recipes_created ON recipes(created_at);
  `);
}

function isTikTokUrl(url: string): boolean {
  return /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/.test(url);
}

async function extractTikTokRecipe(url: string): Promise<StructuredRecipe> {
  try {
    const jsonOutput = execSync(`yt-dlp --dump-json "${url}"`, { encoding: "utf-8" });
    const metadata = JSON.parse(jsonOutput);

    let transcript = metadata.description || "";

    if (metadata.subtitles?.en) {
      const subs = metadata.subtitles.en[0];
      if (subs.data) {
        transcript = subs.data.map((s: Record<string, unknown>) => (s as any).body).join(" ");
      }
    }

    return await structureWithAI(transcript, metadata.title);
  } catch (error) {
    console.error("TikTok extraction failed:", error);
    throw new Error("Failed to extract TikTok metadata");
  }
}

async function extractRegularRecipe(url: string): Promise<StructuredRecipe> {
  try {
    const cheerio = require("cheerio");
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Try JSON-LD first
    const jsonLd = $('script[type="application/ld+json"]').first().html();
    if (jsonLd) {
      const data = JSON.parse(jsonLd);
      if (data["@type"] === "Recipe" || data.type === "Recipe") {
        return {
          title: data.name || "Untitled",
          ingredients: data.recipeIngredient || [],
          instructions: (data.recipeInstructions || [])
            .map((i: Record<string, unknown>) => (i as any).text || i)
            .filter(Boolean),
          prepTime: data.prepTime,
          cookTime: data.cookTime,
          servings: data.recipeYield?.toString(),
          image: data.image?.[0]?.url || data.image,
          tags: data.keywords?.split(",").map((k: string) => k.trim()) || [],
        };
      }
    }

    // Fallback: scrape basic content
    const title = $("h1").first().text() || "Untitled";
    const ingredients = $("li")
      .map((_: number, el: unknown) => $(el).text())
      .get()
      .filter((t: string) => t.length > 5)
      .slice(0, 20);
    const instructions = $("ol li, .instructions li")
      .map((_: number, el: unknown) => $(el).text())
      .get()
      .slice(0, 20);

    return {
      title,
      ingredients,
      instructions,
      tags: ["scraped"],
    };
  } catch (error) {
    console.error("Regular recipe extraction failed:", error);
    throw new Error("Failed to extract recipe from URL");
  }
}

async function structureWithAI(
  text: string,
  titleHint?: string
): Promise<StructuredRecipe> {
  const prompt = `Extract a clean recipe from this text. Output ONLY valid JSON:
{
  "title": "...",
  "ingredients": ["...", "..."],
  "instructions": ["Step 1...", "Step 2..."],
  "prepTime": "...",
  "cookTime": "...",
  "servings": "..."
}

Text: ${text}`;

  try {
    // Try Ollama first (local)
    const ollamaRes = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama2",
        prompt,
        stream: false,
      }),
    });

    if (ollamaRes.ok) {
      const data = await ollamaRes.json();
      const jsonMatch = data.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  } catch (_: unknown) {}

  // Fallback: basic parsing
  return {
    title: titleHint || "Recipe",
    ingredients: text.match(/(?:ingredient|cup|tsp|tbsp|oz|g|lb)[\s\S]*?(?=\n|step|instruction)/gi) || [],
    instructions: text.split(/step\s*\d+|instruction\s*\d+/i).slice(1, 20),
    tags: ["imported"],
  };
}

async function saveRecipe(recipe: StructuredRecipe, sourceUrl?: string) {
  await ensureRecipesTable();
  const id = `recipe_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const pool = await getDb();

  await pool.query(
    `INSERT INTO recipes (id, title, ingredients, instructions, prep_time, cook_time, servings, image, url, tags, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
    [
      id,
      recipe.title,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.instructions),
      recipe.prepTime || null,
      recipe.cookTime || null,
      recipe.servings || null,
      recipe.image || null,
      sourceUrl || null,
      JSON.stringify(recipe.tags || []),
    ]
  );

  return {
    id,
    title: recipe.title,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    servings: recipe.servings,
    image: recipe.image,
    url: sourceUrl,
    tags: recipe.tags || [],
    createdAt: new Date(),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: ImportRequest = await request.json();
    const { url, text } = body;

    if (!url && !text) {
      return NextResponse.json(
        { error: "URL or text required" },
        { status: 400 }
      );
    }

    let recipe: StructuredRecipe;

    if (url) {
      if (isTikTokUrl(url)) {
        recipe = await extractTikTokRecipe(url);
      } else {
        recipe = await extractRegularRecipe(url);
      }
    } else {
      recipe = await structureWithAI(text!);
    }

    const saved = await saveRecipe(recipe, url);
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await ensureRecipesTable();
    const recipes = await queryAll<RecipeRecord>(
      "SELECT * FROM recipes ORDER BY created_at DESC LIMIT 50"
    );

    return NextResponse.json(
      recipes.map((r) => ({
        id: r.id,
        title: r.title,
        ingredients: JSON.parse(r.ingredients),
        instructions: JSON.parse(r.instructions),
        prepTime: r.prep_time,
        cookTime: r.cook_time,
        servings: r.servings,
        image: r.image,
        url: r.url,
        tags: r.tags ? JSON.parse(r.tags) : [],
        createdAt: r.created_at,
      }))
    );
  } catch (error) {
    console.error("Fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recipes" },
      { status: 500 }
    );
  }
}
