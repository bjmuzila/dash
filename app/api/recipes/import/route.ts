import { NextRequest, NextResponse } from "next/server";
import { queryAll, getDb } from "@/lib/db";

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
  prep_time?: string;
  cook_time?: string;
  servings?: string;
  image?: string;
  url?: string;
  notes?: string;
  tags: string;
  created_at: string;
  updated_at: string;
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

async function structureRecipeText(text: string): Promise<StructuredRecipe> {
  // Parse recipe from pasted text
  const lines = text.split('\n');

  let title = 'Recipe';
  let ingredients: string[] = [];
  let instructions: string[] = [];
  let prepTime: string | undefined;
  let cookTime: string | undefined;
  let servings: string | undefined;

  let inIngredients = false;
  let inInstructions = false;
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    // Detect section headers
    if (lower.match(/^(ingredient|ingredient list|ingredients)/)) {
      inIngredients = true;
      inInstructions = false;
      currentSection = 'ingredients';
      continue;
    }
    if (lower.match(/^(instruction|direction|step|method|procedure|how to make|directions)/)) {
      inIngredients = false;
      inInstructions = true;
      currentSection = 'instructions';
      continue;
    }

    // Extract metadata
    if (lower.includes('prep time') || lower.includes('preparation time')) {
      prepTime = trimmed.split(':').pop()?.trim();
      continue;
    }
    if (lower.includes('cook time') || lower.includes('cooking time')) {
      cookTime = trimmed.split(':').pop()?.trim();
      continue;
    }
    if (lower.includes('servings') || lower.includes('serves')) {
      servings = trimmed.split(':').pop()?.trim();
      continue;
    }

    // Extract title (assume first non-metadata line)
    if (!title || title === 'Recipe') {
      if (!lower.includes('time') && !lower.includes('serv')) {
        title = trimmed.replace(/^#+\s*/, '');
        continue;
      }
    }

    // Add to sections
    if (inIngredients && trimmed.length > 2 && !lower.includes('ingredient')) {
      ingredients.push(trimmed);
    } else if (inInstructions && trimmed.length > 2 && !lower.includes('instruction') && !lower.includes('step')) {
      instructions.push(trimmed);
    }
  }

  // Fallback: if no sections found, split roughly in half
  if (ingredients.length === 0 && instructions.length === 0) {
    const nonHeaderLines = lines
      .filter((l) => l.trim() && !l.trim().match(/^#+/))
      .slice(1);

    const mid = Math.ceil(nonHeaderLines.length / 2);
    ingredients = nonHeaderLines.slice(0, mid).filter((l) => l.trim());
    instructions = nonHeaderLines.slice(mid).filter((l) => l.trim());
  }

  return {
    title: title || 'Recipe',
    ingredients: ingredients.slice(0, 50),
    instructions: instructions.slice(0, 50),
    prepTime,
    cookTime,
    servings,
    tags: ['imported'],
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

    if (text) {
      recipe = await structureRecipeText(text);
    } else if (url) {
      // For now, just accept the URL but parse as text
      // Full scraping would require cheerio/yt-dlp
      recipe = {
        title: 'Recipe from URL',
        ingredients: ['Ingredient 1', 'Ingredient 2'],
        instructions: ['Step 1', 'Step 2'],
        tags: ['from-url'],
      };
    } else {
      return NextResponse.json(
        { error: "Text content required for import" },
        { status: 400 }
      );
    }

    const saved = await saveRecipe(recipe, url);
    return NextResponse.json(saved, { status: 201 });
  } catch (error: unknown) {
    console.error("Import error:", error);
    const message = error instanceof Error ? error.message : "Import failed";
    return NextResponse.json(
      { error: message },
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
        prepTime: r.prep_time || undefined,
        cookTime: r.cook_time || undefined,
        servings: r.servings,
        image: r.image,
        url: r.url,
        tags: r.tags ? JSON.parse(r.tags) : [],
        createdAt: new Date(r.created_at),
      }))
    );
  } catch (error: unknown) {
    console.error("Fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recipes" },
      { status: 500 }
    );
  }
}
