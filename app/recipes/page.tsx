'use client';

import { useState, useEffect } from 'react';

const C = {
  bg: "#05060A",
  panel: "#0D1119",
  cyan: "#00F0FF",
  purple: "#8B5CF6",
  orange: "#F97316",
  green: "#10B981",
  red: "#EF4444",
  muted: "#8B94A7",
};

interface Recipe {
  id: string;
  title: string;
  ingredients: string[];
  instructions: string[];
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  image?: string;
  url?: string;
  tags: string[];
  createdAt: Date;
}

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [showImporter, setShowImporter] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('library');

  const filteredRecipes = recipes.filter(r =>
    r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleImport = async () => {
    setLoading(false);
  };

  useEffect(() => {
    setRecipes([]);
  }, []);

  return (
    <div style={{
      height: "100%",
      width: "100%",
      overflow: "hidden",
      background: C.bg,
      backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)",
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 16,
        background: "rgba(13,17,25,0.45)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <span style={{ color: C.cyan, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Recipes
        </span>
        <button
          onClick={() => setShowImporter(!showImporter)}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid rgba(0,229,255,.25)`,
            background: "linear-gradient(180deg,rgba(0,229,255,.12),rgba(0,229,255,.04))",
            color: C.cyan,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Import
        </button>
      </div>

      {/* Import Modal */}
      {showImporter && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "rgba(13,17,25,0.95)",
            backdropFilter: "blur(16px)",
            borderRadius: 16,
            padding: 24,
            width: "90%",
            maxWidth: 500,
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Import Recipe
            </h3>
            <textarea
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Paste recipe URL or text"
              style={{
                width: "100%",
                minHeight: 100,
                padding: 8,
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.4)",
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 11,
                outline: "none",
                marginBottom: 16,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowImporter(false)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={loading || !importUrl.trim()}
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: `1px solid rgba(0,229,255,.25)`,
                  background: "linear-gradient(180deg,rgba(0,229,255,.12),rgba(0,229,255,.04))",
                  color: C.cyan,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "clamp(14px, 2vw, 24px)",
        gap: "clamp(16px, 2vw, 32px)",
        minHeight: 0,
        overflow: "hidden",
      }}>
        {/* Search & Filter */}
        <div style={{
          display: "flex",
          gap: 12,
          flexShrink: 0,
        }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search recipes..."
            style={{
              flex: 1,
              fontSize: 13,
              padding: "8px 12px",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 6,
              background: "rgba(0,0,0,0.4)",
              color: "#fff",
              fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
              outline: "none",
            }}
          />
        </div>

        {/* Recipe Grid */}
        <div style={{
          flex: 1,
          overflow: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}>
          {filteredRecipes.length === 0 ? (
            <div style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: C.muted,
              fontSize: 13,
            }}>
              {recipes.length === 0 ? "No recipes yet. Import one to get started." : "No recipes match your search."}
            </div>
          ) : (
            filteredRecipes.map((recipe) => (
              <div
                key={recipe.id}
                style={{
                  background: "rgba(13,17,25,0.45)",
                  backdropFilter: "blur(16px)",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                {/* Image Placeholder */}
                {recipe.image ? (
                  <img
                    src={recipe.image}
                    alt={recipe.title}
                    style={{
                      width: "100%",
                      height: 160,
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div style={{
                    width: "100%",
                    height: 160,
                    background: `linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(0,240,255,0.05) 100%)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.muted,
                    fontSize: 11,
                  }}>
                    No Image
                  </div>
                )}

                {/* Content */}
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                  <div>
                    <h3 style={{
                      fontSize: 13,
                      fontWeight: 700,
                      margin: "0 0 8px 0",
                      lineHeight: 1.3,
                    }}>
                      {recipe.title}
                    </h3>
                    <div style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}>
                      {recipe.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: 9,
                            padding: "2px 6px",
                            background: `rgba(0,240,255,0.1)`,
                            borderRadius: 4,
                            color: C.cyan,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 9,
                    color: C.muted,
                    flexWrap: "wrap",
                  }}>
                    {recipe.prepTime && (
                      <span>
                        <span style={{ color: C.cyan, fontWeight: 700 }}>PREP:</span> {recipe.prepTime}
                      </span>
                    )}
                    {recipe.cookTime && (
                      <span>
                        <span style={{ color: C.cyan, fontWeight: 700 }}>COOK:</span> {recipe.cookTime}
                      </span>
                    )}
                  </div>

                  <div style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    paddingTop: 12,
                    marginTop: "auto",
                  }}>
                    <div style={{
                      display: "flex",
                      gap: 8,
                      fontSize: 11,
                      color: C.muted,
                      flexWrap: "wrap",
                    }}>
                      <span>
                        <span style={{ color: "#fff", fontWeight: 700 }}>{recipe.ingredients.length}</span> Ingredients
                      </span>
                      <span>
                        <span style={{ color: "#fff", fontWeight: 700 }}>{recipe.instructions.length}</span> Steps
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.04);
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.08);
        }
      `}</style>
    </div>
  );
}
