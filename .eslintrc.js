module.exports = {
	root: true,
	env: {
		node: true,
		commonjs: true,
		jquery: false,
		jest: true,
		jasmine: true
	},
	extends: [
		"eslint:recommended",
		"plugin:jest/recommended",
		"plugin:security/recommended",
		"prettier"
	],
	plugins: ["jest", "security", "prettier"],
	parserOptions: {
		sourceType: "module",
		ecmaVersion: "latest"
	},
	rules: {
		"global-require": ["off"],
		"import/order": ["off"],
		"no-var": ["error"],
		"no-undef": ["off"],
		"no-console": ["off"],
		"no-unused-vars": ["off"],
		"no-param-reassign": ["off"],
		"no-underscore-dangle": ["off"],
		"detect-non-literal-fs-filename": ["off"],
		"prettier/prettier": ["error"]
	}
};
