return {
	server = {
		-- standalone file support ; setting it to false may improve startup time
		standalone = true,

		on_attach = function(_client, bufnr)
			vim.keymap.set("n", "K", function()
				vim.cmd.RustLsp({ "hover", "actions" })
			end, { buffer = bufnr })
			vim.keymap.set("n", "<Leader>ca", function()
				vim.cmd.RustLsp("codeAction")
			end, { buffer = bufnr })
			vim.keymap.set("n", "<Leader>J", function()
				vim.cmd.RustLsp("joinLines")
			end, { buffer = bufnr })
			vim.keymap.set("n", "gl", function()
				vim.cmd.RustLsp("renderDiagnostic")
			end, { buffer = bufnr })
		end,

		settings = {
			["rust-analyzer"] = {
				lens = {
					enable = true,
				},
				checkOnSave = {
					command = "clippy",
				},
			},
		},
	},

}
