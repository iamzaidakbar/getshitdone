/**
 * Categories Controller
 * Handles product category management with hierarchical support
 */

const { Category } = require('../../config/models');
const { ApiError, ApiResponse, asyncHandler, logger } = require('../../utils');

/**
 * Helper: Generate slug from category name
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // spaces to dashes
    .replace(/[^a-z0-9-]/g, '') // remove special chars
    .replace(/-+/g, '-') // collapse multiple dashes
    .replace(/^-|-$/g, ''); // trim dashes
};

/**
 * Create new category
 * POST /api/v1/categories
 * Body: { name, description?, parentId? }
 */
const createCategory = async (req, res, next) => {
  try {
    const { name, description, parentId } = req.body;

    // Generate slug
    const slug = generateSlug(name);

    // Check slug uniqueness
    const existingCategory = await Category.findOne({ slug });
    if (existingCategory) {
      throw new ApiError(409, 'Category with this name already exists');
    }

    // Validate parent if provided
    if (parentId) {
      const parentCategory = await Category.findById(parentId);
      if (!parentCategory) {
        throw new ApiError(404, 'Parent category not found');
      }
    }

    const category = new Category({
      name,
      slug,
      description: description || '',
      parent: parentId || null,
    });

    await category.save();

    logger.info('Category created', {
      categoryId: category._id,
      name,
      parentId,
    });

    await category.populate('parent', 'name slug');

    res.status(201).json(
      new ApiResponse(201, category, 'Category created successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get all categories
 * GET /api/v1/categories
 * Query: { parentId?, includeChildren? }
 */
const getAllCategories = async (req, res, next) => {
  try {
    const { parentId, includeChildren } = req.query;
    const filter = { isActive: true };

    if (parentId) {
      filter.parent = parentId;
    } else if (!includeChildren) {
      // By default, return only root categories
      filter.parent = null;
    }

    const categories = await Category.find(filter)
      .populate('parent', 'name slug')
      .sort({ name: 1 })
      .lean();

    // Calculate product counts for each category
    const { Product } = require('../../config/models');
    const categoriesWithCounts = await Promise.all(
      categories.map(async (cat) => ({
        ...cat,
        productCount: await Product.countDocuments({
          category: cat._id,
          isActive: true,
        }),
      }))
    );

    res.json(
      new ApiResponse(
        200,
        categoriesWithCounts,
        'Categories retrieved successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get category by ID or slug
 * GET /api/v1/categories/:id
 */
const getCategoryById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Try to find by ID first, then by slug
    let category = await Category.findById(id)
      .populate('parent', 'name slug')
      .lean();

    if (!category) {
      category = await Category.findOne({ slug: id })
        .populate('parent', 'name slug')
        .lean();
    }

    if (!category || !category.isActive) {
      throw new ApiError(404, 'Category not found');
    }

    // Get parent breadcrumb
    const breadcrumb = [category];
    let currentParent = category.parent;

    while (currentParent) {
      breadcrumb.unshift(
        await Category.findById(currentParent._id, 'name slug').lean()
      );
      const parent = await Category.findById(currentParent._id).lean();
      currentParent = parent?.parent;
    }

    // Get subcategories
    const children = await Category.find({ parent: category._id, isActive: true })
      .select('name slug')
      .lean();

    // Get product count
    const { Product } = require('../../config/models');
    const productCount = await Product.countDocuments({
      category: category._id,
      isActive: true,
    });

    res.json(
      new ApiResponse(
        200,
        {
          ...category,
          breadcrumb,
          children,
          productCount,
        },
        'Category retrieved successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update category
 * PATCH /api/v1/categories/:id
 * Body: { name?, description?, parentId? }
 */
const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, parentId } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      throw new ApiError(404, 'Category not found');
    }

    // Update name and regenerate slug if name changed
    if (name && name !== category.name) {
      const newSlug = generateSlug(name);
      const existingCategory = await Category.findOne({
        slug: newSlug,
        _id: { $ne: id },
      });
      if (existingCategory) {
        throw new ApiError(409, 'Category with this name already exists');
      }
      category.name = name;
      category.slug = newSlug;
    }

    if (description !== undefined) {
      category.description = description;
    }

    // Update parent if provided
    if (parentId === null) {
      category.parent = null;
    } else if (parentId) {
      const parentCategory = await Category.findById(parentId);
      if (!parentCategory) {
        throw new ApiError(404, 'Parent category not found');
      }
      // Prevent circular parent assignment
      if (parentId === id) {
        throw new ApiError(400, 'Cannot set category as its own parent');
      }
      category.parent = parentId;
    }

    await category.save();

    logger.info('Category updated', {
      categoryId: category._id,
      name: category.name,
    });

    await category.populate('parent', 'name slug');

    res.json(
      new ApiResponse(200, category, 'Category updated successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Delete category (soft delete)
 * DELETE /api/v1/categories/:id
 */
const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      throw new ApiError(404, 'Category not found');
    }

    // Check if category has active children
    const childCount = await Category.countDocuments({
      parent: id,
      isActive: true,
    });

    if (childCount > 0) {
      throw new ApiError(400, 'Cannot delete category with active subcategories');
    }

    // Check if category has products
    const { Product } = require('../../config/models');
    const productCount = await Product.countDocuments({
      category: id,
      isActive: true,
    });

    if (productCount > 0) {
      throw new ApiError(400, 'Cannot delete category with active products');
    }

    // Perform soft delete
    category.isActive = false;
    category.deletedAt = new Date();
    await category.save();

    logger.info('Category deleted', { categoryId: id });

    res.json(new ApiResponse(200, null, 'Category deleted successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
