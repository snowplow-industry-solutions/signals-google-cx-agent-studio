# Widget tools attached to the root agent (issue 09: rich response
# widgets -- productCarousel / productDetails, rendered by the storefront's
# widget-token renderer). Built in the console on 2026-07-29, after the
# initial import reconcile; adopted here so a greenfield re-create
# (see terraform/README.md re-apply steps) still produces a widget-capable agent.
#
# The parameter schemas mirror what the console generated for each typed
# widget (read back from the live tools 2026-07-29); each `properties`
# JSON is the contract the agent instruction's grounding rules
# (instructions.console.widgets.txt constraint 5) are written against.
# display_name is computed by the API from widget_tool.name.

resource "google_ces_tool" "product_carousel" {
  tool_id  = var.product_carousel_tool_id
  location = var.location
  app      = google_ces_app.this.name
  project  = var.project_id

  widget_tool {
    name        = "productCarousel"
    widget_type = "PRODUCT_CAROUSEL"

    parameters {
      type = "OBJECT"
      properties = jsonencode(
        {
          productDetails = {
            description = "Required. An ordered list of products to be displayed."
            type        = "ARRAY"
            items = {
              type = "OBJECT"
              properties = {
                imageUris = {
                  description = "A list of direct URLs to images displaying the product."
                  items = {
                    type = "STRING"
                  }
                  type = "ARRAY"
                }
                price = {
                  description = "The current selling price of the product."
                  type        = "STRING"
                }
                productId = {
                  description = "The unique identifier for this specific product."
                  type        = "STRING"
                }
                subtitle = {
                  description = "A longer, secondary line of text for additional context."
                  type        = "STRING"
                }
                title = {
                  description = "Required. The primary name of the product as listed."
                  type        = "STRING"
                }
                uri = {
                  description = "The URL directing users to the full product detail page."
                  type        = "STRING"
                }
              }
            }
          }
        }
      )
    }
  }

  lifecycle {
    ignore_changes = [
      # Same provider v7.41.0 import gap as the other CES resources:
      # import leaves the create-only, ForceNew tool_id null in state.
      # Greenfield creates still use var.product_carousel_tool_id.
      tool_id,
    ]
  }

  deletion_policy = local.ces_deletion_policy
}

resource "google_ces_tool" "product_details" {
  tool_id  = var.product_details_tool_id
  location = var.location
  app      = google_ces_app.this.name
  project  = var.project_id

  widget_tool {
    name        = "productDetails"
    widget_type = "PRODUCT_DETAILS"

    parameters {
      type = "OBJECT"
      properties = jsonencode(
        {
          imageUris = {
            description = "A list of direct URLs to images displaying the product."
            items = {
              type = "STRING"
            }
            type = "ARRAY"
          }
          price = {
            description = "The current selling price of the product."
            type        = "STRING"
          }
          productId = {
            description = "The unique identifier for this specific product."
            type        = "STRING"
          }
          rating = {
            description = "The average aggregate user rating for the product, typically on a scale of 1.0 to 5.0. Leave null if no ratings exist."
            type        = "NUMBER"
          }
          review = {
            description = "A summary object containing the total count of reviews and a link to read them. Leave null if no reviews exist."
            properties = {
              count = {
                description = "The total number of individual user reviews received for this product."
                type        = "INTEGER"
              }
              reviewUri = {
                description = "The URL directing users to a dedicated page or section where they can read all customer reviews."
                type        = "STRING"
              }
            }
            type = "OBJECT"
          }
          subtitle = {
            description = "A longer, secondary line of text for additional context or description of the product."
            type        = "STRING"
          }
          title = {
            description = "Required. The primary name of the product as listed (e.g., \"Men's Running Shoes\")."
            type        = "STRING"
          }
          uri = {
            description = "The URL directing users to the main product detail page on the website."
            type        = "STRING"
          }
        }
      )
    }
  }

  lifecycle {
    ignore_changes = [
      tool_id,
    ]
  }

  deletion_policy = local.ces_deletion_policy
}
