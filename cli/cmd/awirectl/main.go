package main

import (
	_ "embed"
	"os"

	"github.com/lathe-cli/lathe/pkg/lathe"
	kitup "github.com/samzong/kitup/go"
	kitupcobra "github.com/samzong/kitup/go-cobra"
	"github.com/spf13/cobra"

	"github.com/samzong/awire/cli/internal/generated"
	"github.com/samzong/awire/cli/skills"
)

//go:embed cli.yaml
var manifestBytes []byte

func main() {
	os.Exit(lathe.Run(lathe.RunOptions{
		Manifest: manifestBytes,
		Mount:    mount,
	}))
}

func mount(root *cobra.Command) error {
	if err := generated.MountModules(root); err != nil {
		return err
	}
	root.AddCommand(kitupcobra.NewSkillCommand(kitupcobra.Options{
		AppID:        "awirectl",
		Bundle:       kitup.FSBundle(skills.Awirectl, "awirectl"),
		DefaultScope: kitup.UserScope,
		StdinTTY:     stdinTTY(),
	}))
	return nil
}

func stdinTTY() bool {
	info, err := os.Stdin.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}
