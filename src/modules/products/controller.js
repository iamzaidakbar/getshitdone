/**
 * Products Controller
 * Handles product CRUD, search, filtering, and inventory management
 */

const { Product, Category } = require('../../config/models');
const { ApiError, ApiResponse, asyncHandler, logger } = require('../../utils');

/**
 * Create product (admin only)
 * POST /api/v1/products
 */
const createProduct = async (req, res, next) => {
  try {
    const { name, description, sku, price, comparePrice, stock, category, images, variants } = req.body;

    // Check if SKU is unique
    const existingSku = await Product.findOne({ sku });
    if (existingSku) {
      throw new ApiError(409, 'SKU already exists', { field: 'sku' });
    }

    // Verify category exists
    if (category) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        throw new ApiError(404, 'Category not found');
      }
    }

    // Generate slug from name
    const slug = generateSlug(name);

    // Check slug uniqueness
    const existingSlug = await Product.findOne({ slug });
    if (existingSlug) {
      throw new ApiError(409, 'Product slug already exists', { field: 'slug' });
    }

    const product = new Product({
      name,
      description,
      sku,
      slug,
      price,
      comparePrice,
      stock,
      category,
      images: images || [],
      variants: variants || [],
      createdBy: req.user.id,
    });

    await product.save();

    logger.info('Product created', {
      productId: product._id,
      name: product.name,
      sku: product.sku,
      createdBy: req.user.id,
    });

    res.status(201).json(
      new ApiResponse(201, product.toJSON(), 'Product created successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get all products with filters and pagination
 * GET /api/v1/products?page=1&limit=20&category=xxx&minPrice=100&maxPrice=1000&inStock=true&search=query&sort=price
 */
const getAllProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, category, minPrice, maxPrice, inStock, search, sort } = req.query;

    // Build filter
    const filter = { isActive: true };

    if (category) {
      filter.category = category;
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    if (inStock === 'true') {
      filter.stock = { $gt: 0 };
    }

    // Search using $text index or fallback to regex
    if (search) {
      try {
        // Try text search first
        filter.$text = { $search: search };
      } catch {
        // Fallback to regex search on name and description
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
        ];
      }
    }

    // Determine sort
    let sortObj = { createdAt: -1 }; // Default: newest first
    if (sort === 'price-asc') {
      sortObj = { price: 1 };
    } else if (sort === 'price-desc') {
      sortObj = { price: -1 };
    } else if (sort === 'rating') {
      sortObj = { 'ratings.average': -1 };
    } else if (sort === 'newest') {
      sortObj = { createdAt: -1 };
    }

    const skip = (Number(page) - 1) * Number(limit);

    // Execute query with pagination
    const products = await Product.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(Number(limit))
      .populate('category', 'name slug')
      .lean();

    const total = await Product.countDocuments(filter);

    res.json(
      new ApiResponse(
        200,
        {
          products,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
        'Products retrieved successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get single product by slug or ID
 * GET /api/v1/products/:id
 */
const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Try to find by ID or slug
    const product = await Product.findOne({
      $or: [{ _id: id }, { slug: id }],
      isActive: true,
    })
      .populate('category', 'name slug')
      .populate('createdBy', 'firstName lastName email');

    if (!product) {
      throw new ApiError(404, 'Product not found');
    }

    // Increment view count
    await Product.findByIdAndUpdate(id, { $inc: { views: 1 } });

    res.json(
      new ApiResponse(200, product.toJSON(), 'Product retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get products with faceted filtering
 * GET /api/v1/products/faceted/search
 * Returns products + available filter options (facets)
 */
const getProductsWithFacets = async (req, res, next) => {
  try {
    const { category, minPrice = 0, maxPrice = 100000, inStock = true, search } = req.query;

    // Build aggregation pipeline for faceted search
    const pipeline = [
      { $match: { isActive: true } },
    ];

    // Add text search if provided
    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ],
        },
      });
    }

    // Apply price filter
    pipeline.push({
      $match: {
        price: { $gte: Number(minPrice), $lte: Number(maxPrice) },
      },
    });

    // Apply category filter if provided
    if (category) {
      pipeline.push({ $match: { category: require('mongoose').Types.ObjectId(category) } });
    }

    // Apply stock filter
    if (inStock === 'true') {
      pipeline.push({ $match: { stock: { $gt: 0 } } });
    }

    // Add facets for available filters
    pipeline.push({
      $facet: {
        products: [
          { $sort: { createdAt: -1 } },
          { $limit: 100 }, // Limit to prevent memory issues
        ],
        priceRange: [
          {
            $group: {
              _id: null,
              minPrice: { $min: '$price' },
              maxPrice: { $max: '$price' },
            },
          },
        ],
        categories: [
          {
            $group: {
              _id: '$category',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ],
        ratings: [
          {
            $bucket: {
              groupBy: '$ratings.average',
              boundaries: [0, 2, 3, 4, 4.5, 5],
              default: 0,
              output: { count: { $sum: 1 } },
            },
          },
        ],
      },
    });

    const results = await Product.aggregate(pipeline);

    // Populate category details for facets
    if (results[0].categories.length > 0) {
      const categoryIds = results[0].categories.map((c) => c._id);
      const categories = await Category.find({ _id: { $in: categoryIds } });
      results[0].categories = results[0].categories.map((facet) => {
        const cat = categories.find((c) => c._id.toString() === facet._id.toString());
        return {
          _id: facet._id,
          name: cat?.name || 'Unknown',
          count: facet.count,
        };
      });
    }

    res.json(
      new ApiResponse(
        200,
        {
          products: results[0].products || [],
          facets: {
            priceRange: results[0].priceRange[0] || { minPrice: 0, maxPrice: 0 },
            categories: results[0].categories || [],
            ratings: results[0].ratings || [],
          },
        },
        'Faceted products retrieved successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update product (admin only)
 * PATCH /api/v1/products/:id
 */
const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, category, isActive } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      throw new ApiError(404, 'Product not found');
    }

    // Update slug if name changed
    if (name && name !== product.name) {
      const newSlug = generateSlug(name);
      const existingSlug = await Product.findOne({ slug: newSlug, _id: { $ne: id } });
      if (existingSlug) {
        throw new ApiError(409, 'Product slug already exists', { field: 'slug' });
      }
      product.name = name;
      product.slug = newSlug;
    }

    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = price;
    if (stock !== undefined) product.stock = stock;
    if (category !== undefined) product.category = category;
    if (isActive !== undefined) product.isActive = isActive;

    await product.save();

    logger.info('Product updated', {
      productId: product._id,
      fields: Object.keys(req.body),
      updatedBy: req.user.id,
    });

    res.json(
      new ApiResponse(200, product.toJSON(), 'Product updated successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Delete product (admin only)
 * DELETE /api/v1/products/:id
 */
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    const product = await Product.findByIdAndUpdate(
      id,
      { isActive: false, deletedAt: new Date() },
      { new: true }
    );

    if (!product) {
      throw new ApiError(404, 'Product not found');
    }

    logger.info('Product deleted', {
      productId: id,
      deletedBy: req.user.id,
    });

    res.json(
      new ApiResponse(200, { deletedId: id }, 'Product deleted successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Add product image (upload via multer → sharp → S3)
 * POST /api/v1/products/:id/images
 */
const addProductImage = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      throw new ApiError(400, 'No image file provided');
    }

    // Image processing and S3 upload handled by multer middleware
    // File info should be in req.imageUrl from middleware
    const imageUrl = req.imageUrl;

    if (!imageUrl) {
      throw new ApiError(500, 'Failed to upload image');
    }

    // Add image to product
    const product = await Product.findByIdAndUpdate(
      id,
      { $push: { images: { url: imageUrl, uploadedAt: new Date() } } },
      { new: true }
    );

    if (!product) {
      throw new ApiError(404, 'Product not found');
    }

    logger.info('Product image added', {
      productId: id,
      imageUrl,
      uploadedBy: req.user.id,
    });

    res.json(
      new ApiResponse(200, { imageUrl }, 'Image uploaded successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Decrement stock with optimistic concurrency
 * Allows transaction-safe inventory updates
 * @internal Used by order creation
 */
const decrementStock = async (productId, quantity, session = null) => {
  const product = await Product.findOneAndUpdate(
    {
      _id: productId,
      stock: { $gte: quantity },
    },
    {
      $inc: { stock: -quantity },
    },
    {
      new: true,
      session,
    }
  );

  if (!product) {
    throw new ApiError(409, 'Insufficient stock available');
  }

  return product;
};

/**
 * Get stock status (for order validation)
 * @internal Used by cart/order services
 */
const checkStock = async (items) => {
  const productIds = items.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: productIds } }, { stock: 1 });

  const stockMap = {};
  products.forEach((p) => {
    stockMap[p._id.toString()] = p.stock;
  });

  const unavailable = [];
  items.forEach((item) => {
    const available = stockMap[item.productId.toString()] || 0;
    if (available < item.quantity) {
      unavailable.push({
        productId: item.productId,
        requested: item.quantity,
        available,
      });
    }
  });

  return { available: unavailable.length === 0, unavailable };
};

/**
 * Generate URL-safe slug from product name
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .slice(0, 100); // Limit length
}

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  getProductsWithFacets,
  updateProduct,
  deleteProduct,
  addProductImage,
  decrementStock,
  checkStock,
};
